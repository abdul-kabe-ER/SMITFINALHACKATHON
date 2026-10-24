import { Router } from "express";
import mongoose from "mongoose";
import Attendance from "../models/Attendance.js";
import CompanySettings from "../models/CompanySettings.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
const EMPLOYEE_ROLES = new Set(["employee"]);
const HR_ROLES = new Set(["hr", "admin"]);

function roleOf(user) {
  return String(user?.role || "").toLowerCase();
}

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!roles.includes(roleOf(req.user))) {
      return res.status(403).json({ message: "You do not have permission for this action." });
    }
    next();
  };
}

function localDateKey(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type) => parts.find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function minutesSinceMidnight(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);
  return hour * 60 + minute;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getSettings() {
  let settings = await CompanySettings.findOne({ key: "company" });
  if (!settings) settings = await CompanySettings.create({ key: "company" });
  return settings;
}

function validateLocation(body) {
  const latitude = Number(body?.latitude);
  const longitude = Number(body?.longitude);
  const accuracyMeters = Number(body?.accuracyMeters);
  if (
    !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
    !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
    !Number.isFinite(accuracyMeters) || accuracyMeters < 0
  ) return null;
  return { latitude, longitude, accuracyMeters };
}

async function checkGeofence(body) {
  const location = validateLocation(body);
  if (!location) return { error: "A valid GPS location is required." };
  if (location.accuracyMeters > 100) {
    return { error: "GPS accuracy must be 100 metres or better. Please try again outdoors." };
  }

  const settings = await getSettings();
  const office = settings.officeLocation || {};
  if (!Number.isFinite(office.latitude) || !Number.isFinite(office.longitude)) {
    return { error: "The Admin has not configured the office location yet.", status: 409 };
  }

  const distanceMeters = haversineMeters(
    location.latitude, location.longitude, office.latitude, office.longitude
  );
  const radius = Number(office.radiusMeters) || 150;
  if (distanceMeters > radius) {
    return { error: `You are outside the office radius (${Math.round(distanceMeters)} m away; limit ${radius} m).` };
  }

  return { location: { ...location, distanceMeters: Math.round(distanceMeters) }, settings };
}

// Employee check-in. Server stamps the time; the browser only sends GPS and face count.
router.post(
  "/check-in",
  requireAuth,
  requireRoles(...EMPLOYEE_ROLES),
  async (req, res) => {
    try {
      const source = req.body?.source === "camera" ? "camera" : "web";
      if (source === "camera" && Number(req.body?.faceCount) !== 1) {
        return res.status(422).json({ message: "Camera attendance requires exactly one detected face." });
      }

      const geo = await checkGeofence(req.body);
      if (geo.error) return res.status(geo.status || 422).json({ message: geo.error });

      const now = new Date();
      const timeZone = geo.settings.timezone || "Asia/Karachi";
      const dateKey = localDateKey(now, timeZone);
      const existing = await Attendance.findOne({ employeeId: req.user._id, dateKey });
      if (existing) return res.status(409).json({ message: "You have already checked in today." });

      const start = String(geo.settings.officeStart || "09:00").split(":").map(Number);
      const grace = Number(geo.settings.graceMinutes ?? 15);
      const late = minutesSinceMidnight(now, timeZone) > start[0] * 60 + start[1] + grace;

      const record = await Attendance.create({
        employeeId: req.user._id,
        dateKey,
        checkInAt: now,
        status: late ? "late" : "present",
        source,
        checkInLocation: geo.location,
      });
      return res.status(201).json({ message: "Check-in recorded.", attendance: record });
    } catch (error) {
      if (error?.code === 11000) return res.status(409).json({ message: "You have already checked in today." });
      console.error("Attendance check-in failed:", error);
      return res.status(500).json({ message: "Unable to record check-in." });
    }
  }
);

// Employee check-out. Camera mode applies the same face + geofence checks.
router.post(
  "/check-out",
  requireAuth,
  requireRoles(...EMPLOYEE_ROLES),
  async (req, res) => {
    try {
      const source = req.body?.source === "camera" ? "camera" : "web";
      if (source === "camera" && Number(req.body?.faceCount) !== 1) {
        return res.status(422).json({ message: "Camera attendance requires exactly one detected face." });
      }

      const geo = await checkGeofence(req.body);
      if (geo.error) return res.status(geo.status || 422).json({ message: geo.error });

      const now = new Date();
      const timeZone = geo.settings.timezone || "Asia/Karachi";
      const dateKey = localDateKey(now, timeZone);
      const record = await Attendance.findOne({ employeeId: req.user._id, dateKey });
      if (!record) return res.status(404).json({ message: "No check-in found for today." });
      if (record.checkOutAt) return res.status(409).json({ message: "You have already checked out today." });

      const workedMinutes = Math.max(0, Math.floor((now - record.checkInAt) / 60000));
      record.checkOutAt = now;
      record.workedMinutes = workedMinutes;
      record.checkOutLocation = geo.location;
      if (workedMinutes < 5 * 60) record.status = "half_day";
      await record.save();

      return res.json({ message: "Check-out recorded.", attendance: record });
    } catch (error) {
      console.error("Attendance check-out failed:", error);
      return res.status(500).json({ message: "Unable to record check-out." });
    }
  }
);

router.get("/me/today", requireAuth, requireRoles(...EMPLOYEE_ROLES), async (req, res) => {
  try {
    const settings = await getSettings();
    const dateKey = localDateKey(new Date(), settings.timezone || "Asia/Karachi");
    const attendance = await Attendance.findOne({ employeeId: req.user._id, dateKey }).lean();
    res.json({ dateKey, attendance });
  } catch (error) {
    console.error("Today attendance lookup failed:", error);
    res.status(500).json({ message: "Unable to load today's attendance." });
  }
});

// Admin configures the geofence. HR can view the attendance board, but cannot change settings.
router.put("/office-location", requireAuth, requireRoles("admin"), async (req, res) => {
  try {
    const latitude = Number(req.body?.latitude);
    const longitude = Number(req.body?.longitude);
    const radiusMeters = Number(req.body?.radiusMeters);
    if (
      !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
      !Number.isFinite(radiusMeters) || radiusMeters < 25 || radiusMeters > 5000
    ) {
      return res.status(422).json({ message: "Provide valid coordinates and a radius between 25 and 5000 metres." });
    }

    const settings = await getSettings();
    settings.officeLocation = { latitude, longitude, radiusMeters };
    if (req.body?.timezone) settings.timezone = String(req.body.timezone).slice(0, 80);
    if (req.body?.officeStart && /^\d{2}:\d{2}$/.test(req.body.officeStart)) settings.officeStart = req.body.officeStart;
    if (Number.isFinite(Number(req.body?.graceMinutes))) settings.graceMinutes = Math.max(0, Math.min(180, Number(req.body.graceMinutes)));
    await settings.save();
    res.json({ message: "Office attendance location saved.", settings });
  } catch (error) {
    console.error("Office location save failed:", error);
    res.status(500).json({ message: "Unable to save office location." });
  }
});

router.get("/office-location", requireAuth, requireRoles("admin", "hr"), async (_req, res) => {
  try {
    const settings = await getSettings();
    res.json({
      officeLocation: settings.officeLocation,
      timezone: settings.timezone,
      officeStart: settings.officeStart,
      graceMinutes: settings.graceMinutes,
    });
  } catch (error) {
    res.status(500).json({ message: "Unable to load office location." });
  }
});

router.get("/board", requireAuth, requireRoles(...HR_ROLES), async (req, res) => {
  try {
    const dateKey = String(req.query.date || "");
    const filter = dateKey ? { dateKey } : {};
    const rows = await Attendance.find(filter)
      .populate("employeeId", "name email role")
      .sort({ dateKey: -1, checkInAt: -1 })
      .limit(500)
      .lean();
    res.json({ attendance: rows });
  } catch (error) {
    console.error("Attendance board failed:", error);
    res.status(500).json({ message: "Unable to load attendance board." });
  }
});

export default router;
