import { Router } from "express";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
// Express 4 does not automatically forward rejected async route promises.
for (const method of ["get", "post", "put", "patch", "delete"]) {
  const register = router[method].bind(router);
  router[method] = (...args) => register(...args.map((handler, index) =>
    index === args.length - 1 && typeof handler === "function" && handler.constructor.name === "AsyncFunction"
      ? (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
      : handler
  ));
}
const oid = mongoose.Schema.Types.ObjectId;

function roleOf(role) {
  if (role === "student") return "employee";
  if (role === "teacher") return "hr";
  return role;
}
function publicUser(user) {
  return {
    id: user._id, name: user.name, email: user.email, role: roleOf(user.role),
    employeeCode: user.employeeCode || "", department: user.department || "",
    designation: user.designation || "", phone: user.phone || "", address: user.address || "", salary: Number(user.salary || 0),
    status: user.status || "active", mustChangePassword: !!user.mustChangePassword,
    createdAt: user.createdAt
  };
}
function createToken(user) {
  return jwt.sign({ userId: user._id.toString(), role: roleOf(user.role) }, process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "1d" });
}
function allow(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(roleOf(req.user.role))) return res.status(403).json({ message: "You do not have permission to perform this action." });
    next();
  };
}
function model(name, schema) {
  return mongoose.models[name] || mongoose.model(name, new mongoose.Schema(schema, { timestamps: true, strict: true }));
}
const Settings = model("HcmSettings", {
  companyName: { type: String, default: "" }, officeStart: { type: String, default: "09:00" },
  graceMinutes: { type: Number, default: 15 }, halfDayHours: { type: Number, default: 5 },
  weekendDays: { type: [Number], default: [0, 6] }, holidays: { type: [String], default: [] }, officeLat: { type: Number, default: null },
  officeLng: { type: Number, default: null }, officeRadius: { type: Number, default: 150 },
  leaveQuotas: { type: mongoose.Schema.Types.Mixed, default: { annual: 14, sick: 8, casual: 10, unpaid: 999 } }
});
const Department = model("HcmDepartment", { name: { type: String, required: true, unique: true, trim: true }, designations: { type: [String], default: [] }, active: { type: Boolean, default: true } });
const Attendance = model("HcmAttendance", {
  employee: { type: oid, ref: "User", required: true }, day: { type: String, required: true },
  checkIn: { type: Date, default: null }, checkOut: { type: Date, default: null },
  status: { type: String, enum: ["present", "late", "half_day", "absent", "missing_checkout", "on_leave"], default: "present" },
  source: { type: String, default: "web" }, note: { type: String, default: "" },
  correctionStatus: { type: String, enum: ["none", "pending", "approved", "rejected"], default: "none" }
});
Attendance.schema.index({ employee: 1, day: 1 }, { unique: true });
const Leave = model("HcmLeave", {
  employee: { type: oid, ref: "User", required: true }, type: { type: String, enum: ["annual", "sick", "casual", "unpaid"], required: true },
  start: { type: String, required: true }, end: { type: String, required: true }, reason: { type: String, required: true, maxlength: 1000 },
  days: { type: Number, required: true }, status: { type: String, enum: ["pending", "approved", "rejected", "cancelled"], default: "pending" },
  decisionComment: { type: String, default: "" }, decidedBy: { type: oid, ref: "User", default: null }
});
const Payroll = model("HcmPayroll", {
  month: { type: String, required: true, unique: true }, status: { type: String, enum: ["draft", "finalized"], default: "draft" },
  rows: { type: [mongoose.Schema.Types.Mixed], default: [] }, grossTotal: { type: Number, default: 0 }, netTotal: { type: Number, default: 0 },
  finalizedBy: { type: oid, ref: "User", default: null }, finalizedAt: { type: Date, default: null }
});
const Announcement = model("HcmAnnouncement", {
  title: { type: String, required: true, trim: true, maxlength: 160 }, body: { type: String, required: true, maxlength: 3000 },
  audience: { type: String, enum: ["all", "hr", "employee"], default: "all" }, author: { type: oid, ref: "User", required: true }
});
const aiRequestTimes = new Map();
const Audit = model("HcmAudit", {
  actor: { type: oid, ref: "User", required: true }, action: { type: String, required: true },
  entity: { type: String, required: true }, entityId: { type: String, default: "" },
  before: { type: mongoose.Schema.Types.Mixed, default: null }, after: { type: mongoose.Schema.Types.Mixed, default: null }
});

async function audit(req, action, entity, entityId = "", before = null, after = null) {
  await Audit.create({ actor: req.user._id, action, entity, entityId: String(entityId || ""), before, after });
}
function dayKey(date = new Date()) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function workingDays(start, end, weekendDays = [0, 6], holidays = []) {
  const a = new Date(`${start}T12:00:00`), b = new Date(`${end}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || a > b) return 0;
  let count = 0;
  for (const d = new Date(a); d <= b; d.setDate(d.getDate()+1)) if (!weekendDays.includes(d.getDay()) && !holidays.includes(dayKey(d))) count++;
  return count;
}
function haversine(lat1, lon1, lat2, lon2) {
  const r = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(lat2-lat1), dLon = rad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(dLon/2)**2;
  return 2*r*Math.asin(Math.sqrt(a));
}
async function currentSettings() {
  let settings = await Settings.findOne();
  if (!settings) settings = await Settings.create({});
  return settings;
}
async function leaveBalance(employeeId, year = new Date().getFullYear()) {
  const settings = await currentSettings();
  const approved = await Leave.find({ employee: employeeId, status: "approved", start: { $regex: `^${year}-` } });
  const used = { annual: 0, sick: 0, casual: 0, unpaid: 0 };
  approved.forEach(x => { used[x.type] = (used[x.type] || 0) + x.days; });
  const quotas = settings.leaveQuotas || { annual: 14, sick: 8, casual: 10, unpaid: 999 };
  return Object.fromEntries(["annual","sick","casual","unpaid"].map(type => [type, { quota: quotas[type] ?? 0, used: used[type] || 0, remaining: Math.max(0, (quotas[type] ?? 0) - (used[type] || 0)) }]));
}

// First-run bootstrap: creates the company settings and first Admin only when no users exist.
router.get("/setup/status", async (_req, res) => {
  try { res.json({ setupRequired: (await User.countDocuments()) === 0 }); }
  catch { res.status(500).json({ message: "Unable to check setup status." }); }
});
router.post("/setup", async (req, res) => {
  try {
    if (await User.countDocuments()) return res.status(409).json({ message: "Initial setup has already been completed." });
    const { companyName, name, email, password } = req.body || {};
    if (!companyName?.trim() || !name?.trim() || !email || typeof password !== "string" || password.length < 8) {
      return res.status(400).json({ message: "Company, admin name, valid email, and a password of at least 8 characters are required." });
    }
    const user = await User.create({ name: name.trim(), email: String(email).trim().toLowerCase(), password: await bcrypt.hash(password, 12), role: "admin" });
    await Settings.create({ companyName: companyName.trim() });
    await audit({ user }, "setup.created", "organization", "", null, { companyName: companyName.trim() });
    res.status(201).json({ message: "Company setup complete.", token: createToken(user), user: publicUser(user) });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: "That email is already registered." });
    console.error("Setup error:", error); res.status(500).json({ message: "Unable to complete first-run setup." });
  }
});

// Public signup is intentionally disabled: HR creates employee accounts; the first Admin is created via setup.
router.post("/signup", (_req, res) => res.status(403).json({ message: "Accounts are created by HR or through first-run Admin setup. Please contact your administrator." }));

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ message: "Email and password are required." });
    const user = await User.findOne({ email: String(email).trim().toLowerCase() }).select("+password");
    if (!user || !(await bcrypt.compare(String(password), user.password)) || user.status === "inactive" || user.status === "exited") {
      return res.status(401).json({ message: "Invalid email or password, or account is inactive." });
    }
    res.json({ message: "Login successful.", token: createToken(user), user: publicUser(user) });
  } catch (error) { console.error("Login error:", error); res.status(500).json({ message: "Unable to log in right now." }); }
});
router.get("/me", requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));
router.post("/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof newPassword !== "string" || newPassword.length < 8 || newPassword.length > 72) return res.status(400).json({ message: "New password must be 8–72 characters." });
  const user = await User.findById(req.user._id).select("+password");
  if (!user || !(await bcrypt.compare(String(currentPassword || ""), user.password))) return res.status(400).json({ message: "Current password is incorrect." });
  user.password = await bcrypt.hash(newPassword, 12); user.mustChangePassword = false; await user.save();
  await audit(req, "password.changed", "user", user._id);
  res.json({ message: "Password changed successfully." });
});

// Organization and department setup
router.get("/settings", requireAuth, allow("admin", "hr"), async (_req, res) => res.json({ settings: await currentSettings() }));
router.put("/settings", requireAuth, allow("admin"), async (req, res) => {
  const allowed = ["companyName","officeStart","graceMinutes","halfDayHours","weekendDays","holidays","officeLat","officeLng","officeRadius","leaveQuotas"];
  const update = {};
  for (const key of allowed) if (req.body?.[key] !== undefined) update[key] = req.body[key];
  const settings = await Settings.findOneAndUpdate({}, { $set: update }, { upsert: true, new: true, runValidators: true });
  await audit(req, "settings.updated", "settings", settings._id, null, update);
  res.json({ settings });
});
router.get("/departments", requireAuth, allow("admin", "hr"), async (_req, res) => res.json({ departments: await Department.find({ active: true }).sort({ name: 1 }) }));
router.post("/departments", requireAuth, allow("admin"), async (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (name.length < 2 || name.length > 100) return res.status(400).json({ message: "Department name must be 2–100 characters." });
  try {
    const department = await Department.create({ name, designations: Array.isArray(req.body.designations) ? req.body.designations.map(String).slice(0,50) : [] });
    await audit(req, "department.created", "department", department._id, null, { name });
    res.status(201).json({ department });
  } catch (e) { res.status(e.code === 11000 ? 409 : 500).json({ message: e.code === 11000 ? "Department already exists." : "Unable to create department." }); }
});

// HR employee directory, employee profile is restricted to its owner.
router.get("/employees", requireAuth, async (req, res) => {
  const role = roleOf(req.user.role);
  if (role === "employee") return res.json({ employees: [publicUser(req.user)] });
  if (!["admin","hr"].includes(role)) return res.status(403).json({ message: "Not permitted." });
  const { q = "", department = "", status = "", page = "1", limit = "50" } = req.query;
  const filter = { role: { $in: ["employee", "student"] } };
  if (department) filter.department = department;
  if (status) filter.status = status;
  if (q) filter.$or = [{ name: { $regex: String(q).slice(0,80), $options: "i" } }, { email: { $regex: String(q).slice(0,120), $options: "i" } }, { employeeCode: { $regex: String(q).slice(0,50), $options: "i" } }];
  const p = Math.max(1, Number(page) || 1), size = Math.min(100, Math.max(1, Number(limit) || 50));
  const [employees, total] = await Promise.all([User.find(filter).sort({ name: 1 }).skip((p-1)*size).limit(size), User.countDocuments(filter)]);
  res.json({ employees: employees.map(publicUser), total, page: p, pages: Math.ceil(total/size) });
});
router.post("/employees", requireAuth, allow("hr"), async (req, res) => {
  try {
    const { name, email, department = "", designation = "", salary = 0, phone = "", address = "", dateOfJoining, employeeCode } = req.body || {};
    if (!name?.trim() || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email)) || !designation.trim() || Number(salary) <= 0) return res.status(400).json({ message: "Name, valid email, designation, and salary greater than zero are required." });
    const temporaryPassword = `Hcm-${Math.random().toString(36).slice(2,8)}-${Math.random().toString(36).slice(2,6)}!`;
    const employee = await User.create({
      name: name.trim(), email: String(email).trim().toLowerCase(), password: await bcrypt.hash(temporaryPassword,12),
      role: "employee", department: String(department).trim(), designation: String(designation).trim(), salary: Number(salary),
      phone: String(phone), address: String(address), dateOfJoining: dateOfJoining || new Date(),
      employeeCode: employeeCode || `EMP-${Date.now().toString().slice(-7)}`, mustChangePassword: true
    });
    await audit(req, "employee.created", "user", employee._id, null, { name: employee.name, email: employee.email, employeeCode: employee.employeeCode });
    res.status(201).json({ employee: publicUser(employee), temporaryPassword });
  } catch (e) { res.status(e.code === 11000 ? 409 : 500).json({ message: e.code === 11000 ? "Email or employee code already exists." : "Unable to register employee." }); }
});
router.post("/users/hr", requireAuth, allow("admin"), async (req, res) => {
  try {
    const { name, email, department = "" } = req.body || {};
    if (!name?.trim() || !email) return res.status(400).json({ message: "Name and email are required." });
    const temporaryPassword = `Hcm-${Math.random().toString(36).slice(2,8)}-${Math.random().toString(36).slice(2,6)}!`;
    const hr = await User.create({ name: name.trim(), email: String(email).trim().toLowerCase(), password: await bcrypt.hash(temporaryPassword,12), role: "hr", department, employeeCode: `HR-${Date.now().toString().slice(-7)}`, mustChangePassword: true });
    await audit(req, "hr.created", "user", hr._id, null, { name: hr.name, email: hr.email });
    res.status(201).json({ employee: publicUser(hr), temporaryPassword });
  } catch (e) { res.status(e.code === 11000 ? 409 : 500).json({ message: e.code === 11000 ? "Email already exists." : "Unable to create HR login." }); }
});
router.patch("/employees/:id", requireAuth, async (req, res) => {
  const self = String(req.user._id) === String(req.params.id);
  if (!self && !["admin","hr"].includes(roleOf(req.user.role))) return res.status(403).json({ message: "Not permitted." });
  const allowed = self ? ["phone","address"] : ["name","department","designation","salary","phone","address","status","dateOfJoining"];
  const update = {};
  for (const key of allowed) if (req.body?.[key] !== undefined) update[key] = req.body[key];
  const employee = await User.findByIdAndUpdate(req.params.id, { $set: update }, { new: true, runValidators: true });
  if (!employee) return res.status(404).json({ message: "Employee not found." });
  await audit(req, "employee.updated", "user", employee._id, null, update);
  res.json({ employee: publicUser(employee) });
});

// Web attendance. Server creates timestamps and decides late status; client cannot submit a check-in time.
router.get("/attendance", requireAuth, async (req, res) => {
  const role = roleOf(req.user.role);
  const filter = {};
  if (role === "employee") filter.employee = req.user._id;
  else if (!["admin","hr"].includes(role)) return res.status(403).json({ message: "Not permitted." });
  if (req.query.day) filter.day = String(req.query.day);
  if (req.query.month) filter.day = { $regex: `^${String(req.query.month).slice(0,7)}` };
  const records = await Attendance.find(filter).populate("employee", "name email employeeCode department").sort({ day: -1, checkIn: -1 }).limit(500);
  res.json({ attendance: records });
});
router.post("/attendance/check-in", requireAuth, allow("employee"), async (req, res) => {
  const day = dayKey(), settings = await currentSettings();
  const existing = await Attendance.findOne({ employee: req.user._id, day });
  if (existing?.checkIn) return res.status(409).json({ message: "You have already checked in today.", attendance: existing });
  const now = new Date(), [h,m] = String(settings.officeStart || "09:00").split(":").map(Number);
  const lateAt = new Date(now); lateAt.setHours(h || 9, (m || 0) + Number(settings.graceMinutes || 0), 0, 0);
  const record = existing || new Attendance({ employee: req.user._id, day });
  record.checkIn = now; record.status = now > lateAt ? "late" : "present"; record.source = "web";
  await record.save(); await audit(req, "attendance.check_in", "attendance", record._id, null, { day, status: record.status });
  res.status(201).json({ attendance: record });
});
router.post("/attendance/check-out", requireAuth, allow("employee"), async (req, res) => {
  const day = dayKey(), record = await Attendance.findOne({ employee: req.user._id, day });
  if (!record?.checkIn) return res.status(409).json({ message: "Check in before checking out." });
  if (record.checkOut) return res.status(409).json({ message: "You have already checked out today." });
  const settings = await currentSettings(); record.checkOut = new Date();
  const hours = (record.checkOut - record.checkIn) / 3600000;
  if (hours < Number(settings.halfDayHours || 5)) record.status = "half_day";
  await record.save(); await audit(req, "attendance.check_out", "attendance", record._id, null, { hours: Number(hours.toFixed(2)), status: record.status });
  res.json({ attendance: record, hours: Number(hours.toFixed(2)) });
});
router.post("/attendance/correction", requireAuth, allow("employee"), async (req, res) => {
  const { day, note } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day)) || !String(note || "").trim()) return res.status(400).json({ message: "A valid date and correction reason are required." });
  const record = await Attendance.findOneAndUpdate({ employee: req.user._id, day }, { $set: { note: String(note).trim(), correctionStatus: "pending" } }, { new: true, upsert: true, setDefaultsOnInsert: true });
  await audit(req, "attendance.correction_requested", "attendance", record._id, null, { day, note });
  res.json({ attendance: record });
});
router.patch("/attendance/:id/correction", requireAuth, allow("hr"), async (req, res) => {
  const record = await Attendance.findById(req.params.id);
  if (!record) return res.status(404).json({ message: "Attendance record not found." });
  const { decision, note } = req.body || {};
  if (!["approved","rejected"].includes(decision)) return res.status(400).json({ message: "Decision must be approved or rejected." });
  record.correctionStatus = decision; if (note) record.note = String(note).slice(0,1000); await record.save();
  await audit(req, `attendance.correction_${decision}`, "attendance", record._id);
  res.json({ attendance: record });
});

// Leave requests and approvals. Weekends are excluded; overlapping requests are rejected.
router.get("/leaves", requireAuth, async (req, res) => {
  const filter = roleOf(req.user.role) === "employee" ? { employee: req.user._id } : {};
  const leaves = await Leave.find(filter).populate("employee", "name email employeeCode department").populate("decidedBy", "name").sort({ createdAt: -1 }).limit(500);
  const balance = roleOf(req.user.role) === "employee" ? await leaveBalance(req.user._id) : null;
  res.json({ leaves, balance });
});
router.post("/leaves", requireAuth, allow("employee"), async (req, res) => {
  const { type, start, end, reason } = req.body || {};
  if (!["annual","sick","casual","unpaid"].includes(type) || !/^\d{4}-\d{2}-\d{2}$/.test(String(start)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(end)) || !String(reason || "").trim()) return res.status(400).json({ message: "Choose a leave type, valid dates, and a reason." });
  const settings = await currentSettings(), days = workingDays(start, end, settings.weekendDays || [0,6]);
  if (!days) return res.status(422).json({ message: "The date range contains no working days or is invalid." });
  const overlap = await Leave.findOne({ employee: req.user._id, status: { $in: ["pending","approved"] }, start: { $lte: end }, end: { $gte: start } });
  if (overlap) return res.status(422).json({ message: "This leave overlaps another pending or approved request." });
  const balance = await leaveBalance(req.user._id, Number(String(start).slice(0,4)));
  if (type !== "unpaid" && days > balance[type].remaining) return res.status(422).json({ message: `Not enough ${type} leave balance. Remaining: ${balance[type].remaining} day(s).` });
  const leave = await Leave.create({ employee: req.user._id, type, start, end, reason: String(reason).trim(), days });
  await audit(req, "leave.created", "leave", leave._id, null, { type, start, end, days });
  res.status(201).json({ leave });
});
router.patch("/leaves/:id/decision", requireAuth, allow("hr"), async (req, res) => {
  const leave = await Leave.findById(req.params.id);
  if (!leave) return res.status(404).json({ message: "Leave request not found." });
  if (leave.status !== "pending") return res.status(409).json({ message: "Only pending requests can be decided." });
  const { decision, comment = "" } = req.body || {};
  if (!["approved","rejected"].includes(decision)) return res.status(400).json({ message: "Decision must be approved or rejected." });
  if (decision === "approved") {
    const balance = await leaveBalance(leave.employee, Number(leave.start.slice(0,4)));
    if (leave.type !== "unpaid" && leave.days > balance[leave.type].remaining) return res.status(422).json({ message: "Insufficient balance now; review the employee's other approved leave." });
  }
  leave.status = decision; leave.decisionComment = String(comment).slice(0,1000); leave.decidedBy = req.user._id; await leave.save();
  await audit(req, `leave.${decision}`, "leave", leave._id, null, { status: decision, comment });
  res.json({ leave });
});
router.patch("/leaves/:id/cancel", requireAuth, allow("employee"), async (req, res) => {
  const leave = await Leave.findOne({ _id: req.params.id, employee: req.user._id, status: "pending" });
  if (!leave) return res.status(404).json({ message: "Pending leave request not found." });
  leave.status = "cancelled"; await leave.save(); await audit(req, "leave.cancelled", "leave", leave._id); res.json({ leave });
});

// Payroll draft and finalization. Admin alone can lock a payroll month.
function taxForAnnual(annual) {
  if (annual <= 600000) return 0;
  if (annual <= 1200000) return annual * .05;
  if (annual <= 2400000) return 30000 + (annual-1200000)*.15;
  if (annual <= 3600000) return 210000 + (annual-2400000)*.25;
  return 510000 + (annual-3600000)*.35;
}
router.get("/payroll", requireAuth, async (req, res) => {
  const role = roleOf(req.user.role);
  if (role === "employee") {
    const runs = await Payroll.find({ "rows.employee": req.user._id }).sort({ month: -1 });
    return res.json({ payroll: runs.map(run => ({ month: run.month, status: run.status, payslip: run.rows.find(r => String(r.employee) === String(req.user._id)) })) });
  }
  if (!["admin","hr"].includes(role)) return res.status(403).json({ message: "Not permitted." });
  res.json({ payroll: await Payroll.find().sort({ month: -1 }).limit(24) });
});
router.post("/payroll/run", requireAuth, allow("hr"), async (req, res) => {
  const month = String(req.body?.month || "").slice(0,7);
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ message: "Month must be YYYY-MM." });
  if (await Payroll.exists({ month, status: "finalized" })) return res.status(409).json({ message: "This payroll month is finalized and locked." });
  const employees = await User.find({ role: "employee", status: { $in: ["active","probation"] } });
  const settings = await currentSettings();
  const [year, mm] = month.split("-").map(Number);
  const daysInMonth = new Date(year, mm, 0).getDate();
  const workDays = Array.from({length:daysInMonth},(_,i)=>new Date(year,mm-1,i+1)).filter(d=>!(settings.weekendDays||[0,6]).includes(d.getDay())).length || 1;
  const rows = [];
  for (const employee of employees) {
    const basic = Number(employee.salary || 0), gross = basic * 1.5;
    const attendance = await Attendance.find({ employee: employee._id, day: { $regex: `^${month}` } });
    const absent = attendance.filter(a=>a.status==="absent").length;
    const half = attendance.filter(a=>a.status==="half_day").length;
    const unpaid = await Leave.find({ employee: employee._id, status:"approved", type:"unpaid", start:{$lte:`${month}-31`}, end:{$gte:`${month}-01`} });
    const unpaidDays = unpaid.reduce((n,l)=>n+l.days,0);
    const deduction = Math.min(gross, (gross/workDays)*(absent+unpaidDays+0.5*half));
    const tax = taxForAnnual(gross*12)/12;
    rows.push({ employee: employee._id, employeeName: employee.name, employeeCode: employee.employeeCode || "", department: employee.department || "", basic: Number(basic.toFixed(2)), hra: Number((basic*.4).toFixed(2)), medical: Number((basic*.1).toFixed(2)), gross: Number(gross.toFixed(2)), absentDays: absent, halfDays: half, unpaidDays, deduction: Number(deduction.toFixed(2)), tax: Number(tax.toFixed(2)), net: Number(Math.max(0,gross-deduction-tax).toFixed(2)) });
  }
  const grossTotal = rows.reduce((n,r)=>n+r.gross,0), netTotal = rows.reduce((n,r)=>n+r.net,0);
  const run = await Payroll.findOneAndUpdate({ month }, { $set: { rows, grossTotal, netTotal, status: "draft" } }, { upsert: true, new: true });
  await audit(req, "payroll.draft_created", "payroll", run._id, null, { month, grossTotal, netTotal });
  res.status(201).json({ payroll: run });
});
router.patch("/payroll/:id/finalize", requireAuth, allow("admin"), async (req, res) => {
  const run = await Payroll.findById(req.params.id);
  if (!run) return res.status(404).json({ message: "Payroll run not found." });
  if (run.status === "finalized") return res.status(409).json({ message: "Payroll is already finalized." });
  run.status = "finalized"; run.finalizedBy = req.user._id; run.finalizedAt = new Date(); await run.save();
  await audit(req, "payroll.finalized", "payroll", run._id, { status:"draft" }, { status:"finalized", month:run.month });
  res.json({ payroll: run });
});

// Announcements and audit trail
router.get("/announcements", requireAuth, async (req, res) => {
  const role = roleOf(req.user.role);
  const announcements = await Announcement.find({ audience: { $in: ["all", role] } }).populate("author","name").sort({ createdAt:-1 }).limit(100);
  res.json({ announcements });
});
router.post("/announcements", requireAuth, allow("admin","hr"), async (req, res) => {
  const { title, body, audience = "all" } = req.body || {};
  if (!title?.trim() || !body?.trim() || !["all","hr","employee"].includes(audience)) return res.status(400).json({ message: "Title, message, and valid audience are required." });
  const announcement = await Announcement.create({ title: title.trim(), body: body.trim(), audience, author: req.user._id });
  await audit(req, "announcement.created", "announcement", announcement._id, null, { title, audience });
  res.status(201).json({ announcement });
});
router.get("/audit", requireAuth, allow("admin"), async (_req, res) => {
  const events = await Audit.find().populate("actor","name email role").sort({ createdAt:-1 }).limit(250);
  res.json({ events });
});

// Server-computed dashboard numbers and role-scoped data.
router.get("/dashboard/summary", requireAuth, async (req, res) => {
  const role = roleOf(req.user.role), today = dayKey(), month = today.slice(0,7);
  if (role === "employee") {
    const [attendance, leaves, balance, payroll, announcements] = await Promise.all([
      Attendance.find({ employee:req.user._id, day:{$regex:`^${month}`} }),
      Leave.find({ employee:req.user._id }).sort({createdAt:-1}).limit(5),
      leaveBalance(req.user._id),
      Payroll.find({ "rows.employee":req.user._id, status:"finalized" }).sort({month:-1}).limit(1),
      Announcement.find({ audience:{$in:["all","employee"]} }).sort({createdAt:-1}).limit(5)
    ]);
    return res.json({ summary:{ role, today:attendance.find(a=>a.day===today)||null, hoursThisMonth: Number(attendance.reduce((n,a)=>n+(a.checkIn&&a.checkOut?(a.checkOut-a.checkIn)/3600000:0),0).toFixed(1)), lateCount:attendance.filter(a=>a.status==="late").length, leaveBalance:balance, recentLeaves:leaves, lastPayslip:payroll[0]?.rows?.find(r=>String(r.employee)===String(req.user._id))||null, announcements } });
  }
  const filter = role==="hr" ? { role:"employee", status:{$in:["active","probation"]} } : { role:"employee" };
  const [headcount, todayRecords, pendingLeaves, lateRecords, departments, payroll, announcements] = await Promise.all([
    User.countDocuments(filter), Attendance.find({day:today}).populate("employee","name department"),
    Leave.countDocuments({status:"pending"}), Attendance.find({day:today,status:"late"}).populate("employee","name department"),
    Department.find({active:true}), Payroll.find().sort({month:-1}).limit(6), Announcement.find({audience:{$in:["all",role]} }).sort({createdAt:-1}).limit(5)
  ]);
  const onLeave = await Leave.find({status:"approved",start:{$lte:today},end:{$gte:today}}).populate("employee","name department");
  const byDepartment = await User.aggregate([{ $match:filter },{ $group:{_id:{$ifNull:["$department","Unassigned"]},count:{$sum:1}} },{ $sort:{count:-1} }]);
  res.json({ summary:{role,headcount,present:todayRecords.length,onLeave:onLeave.length,late:lateRecords.length,pendingLeaves,lateComers:lateRecords.map(x=>({name:x.employee?.name,department:x.employee?.department})),byDepartment,departments:departments.map(d=>d.name),payroll:payroll.map(p=>({month:p.month,status:p.status,grossTotal:p.grossTotal,netTotal:p.netTotal})),announcements} });
});

// AI key stays on the backend. If not configured, provide a safe policy helper instead of breaking the app.
router.post("/ai/chat", requireAuth, async (req, res) => {
  const question = String(req.body?.message || "").trim().slice(0,1500);
  if (!question) return res.status(400).json({ message: "Write a question first." });
  const userKey = String(req.user._id), nowMs = Date.now();
  const recentRequests = (aiRequestTimes.get(userKey) || []).filter(timestamp => nowMs - timestamp < 60 * 60 * 1000);
  if (recentRequests.length >= 20) return res.status(429).json({ message: "Assistant limit reached. Please try again in about an hour." });
  recentRequests.push(nowMs); aiRequestTimes.set(userKey, recentRequests);
  const role = roleOf(req.user.role);
  const asksOwnCompensation = /\b(my|mine|own)\s+(salary|payroll|payslip|pay)\b/i.test(question) || /\bwhat(?:'s| is) my (?:salary|pay|payslip)\b/i.test(question);
  if (role === "employee" && /\b(salary|payroll|payslip)\b/i.test(question) && !asksOwnCompensation) {
    await audit(req, "ai.chat", "ai_log", "", null, { deniedSensitiveQuestion:true });
    return res.json({ answer: "I can only help you with your own salary or payslip information, not another employee’s private compensation.", aiGenerated: true, source: "privacy-rule" });
  }
  const policy = "Office start time comes from company settings; default 09:00 with a 15-minute grace period. Annual leave quota is 14 days, sick 8, casual 10, and unpaid leave is unlimited by quota. Leave counts working days only and overlapping requests or requests beyond the available balance are rejected. Attendance timestamps are set by the server. HR approves or rejects leave. Only Admin finalizes payroll. Employees can view only their own records.";
  const today = dayKey();
  let dataContext = {};
  if (role === "employee") {
    const [balance, ownAttendance, ownPending] = await Promise.all([
      leaveBalance(req.user._id), Attendance.find({ employee:req.user._id, day:{$regex:`^${today.slice(0,7)}`} }),
      Leave.countDocuments({ employee:req.user._id, status:"pending" })
    ]);
    dataContext = { scope:"own records only", leaveBalance:balance, attendanceThisMonth:{ recordedDays:ownAttendance.length, lateCount:ownAttendance.filter(a=>a.status==="late").length }, pendingLeaveRequests:ownPending };
  } else {
    const [activeEmployees, records, late, pendingLeaves, onLeave] = await Promise.all([
      User.countDocuments({ role:{$in:["employee","student"]}, status:{$in:["active","probation"]} }),
      Attendance.countDocuments({ day:today }),
      Attendance.find({ day:today, status:"late" }).populate("employee","name department"),
      Leave.countDocuments({ status:"pending" }),
      Leave.countDocuments({ status:"approved", start:{$lte:today}, end:{$gte:today} })
    ]);
    dataContext = { scope:role==="admin"?"company-wide data":"HR operational data", activeEmployees, attendanceRecordsToday:records, lateComersToday:late.map(a=>({name:a.employee?.name,department:a.employee?.department})), pendingLeaveRequests:pendingLeaves, employeesOnLeaveToday:onLeave };
  }
  let answer = "";
  if (process.env.AI_API_KEY) {
    try {
      const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),15000);
      const response = await fetch(process.env.AI_API_URL || "https://api.openai.com/v1/chat/completions", {
        method:"POST", signal:controller.signal, headers:{ "Content-Type":"application/json", Authorization:`Bearer ${process.env.AI_API_KEY}` },
        body:JSON.stringify({ model:process.env.AI_MODEL || "gpt-4o-mini", messages:[{role:"system",content:`You are HCM Lite's HR policy assistant. Answer only from the provided policy and authorized data. Do not reveal another employee's salary or private records. If the policy does not answer, say you do not know. User role: ${role}. Policy: ${policy}. Authorized live data from the same server-side services: ${JSON.stringify(dataContext)}`},{role:"user",content:question}], temperature:0.2 })
      });
      clearTimeout(timer);
      const data = await response.json();
      if (response.ok) answer = data.choices?.[0]?.message?.content || "";
    } catch { /* friendly local fallback below */ }
  }
  if (!answer) {
    if (role !== "employee" && /how many .*active employees|active headcount|headcount/i.test(question)) answer = `There are ${dataContext.activeEmployees} active or probationary employees in the current company data.`;
    else if (role !== "employee" && /who .*late|late.?comers|came late/i.test(question)) answer = dataContext.lateComersToday?.length ? `Today's late arrivals: ${dataContext.lateComersToday.map(x=>`${x.name} (${x.department || "Unassigned"})`).join(", ")}.` : "No late arrivals are recorded for today.";
    else if (role === "employee" && /how many .*sick|sick.*left|leave balance/i.test(question)) answer = `Your sick leave balance is ${dataContext.leaveBalance?.sick?.remaining ?? 0} day(s) remaining out of ${dataContext.leaveBalance?.sick?.quota ?? 8}.`;
    else if (/leave|sick|casual|annual|quota|balance/i.test(question)) answer = `Company leave policy: ${policy} Your current leave balance is available in the Leave section.`;
    else if (/late|attendance|check.?in|office/i.test(question)) answer = `Attendance policy: ${policy}`;
    else if (/payroll|tax|salary|payslip/i.test(question)) answer = role==="employee" ? "You can view your own finalized payslips in the Payroll section. I cannot disclose anyone else's salary." : "Payroll is calculated from employee salary, attendance deductions, unpaid leave and the illustrative annual tax slabs. HR creates drafts; only Admin finalizes them.";
    else answer = `I can help with company leave, attendance and payroll policies. ${policy} For organization-specific details, ask your Admin or HR team.`;
  }
  await audit(req, "ai.chat", "ai_log", "", null, { question, role });
  res.json({ answer, aiGenerated:true, source:process.env.AI_API_KEY ? "assistant" : "policy-fallback" });
});

export default router;
