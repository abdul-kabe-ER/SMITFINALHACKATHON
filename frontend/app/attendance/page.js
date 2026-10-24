
"use client";

import "./attendance.css";

import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api"
).replace(/\/$/, "");

const TASKS_VERSION = "0.10.14";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

export default function AttendancePage() {
  const videoRef = useRef(null);
  const detectorRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const lastDetectRef = useRef(0);
  const mountedRef = useRef(false);

  const [faceCount, setFaceCount] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [today, setToday] = useState(null);
  const [office, setOffice] = useState(null);
  const [adminLat, setAdminLat] = useState("");
  const [adminLng, setAdminLng] = useState("");
  const [radius, setRadius] = useState("150");
  const [role, setRole] = useState("");
  const [loading, setLoading] = useState(true);

  const token = () => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("authToken");
  };

  const api = useCallback(async (path, options = {}) => {
    const authToken = token();

    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(authToken
          ? { Authorization: `Bearer ${authToken}` }
          : {}),
        ...(options.headers || {}),
      },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error(
          "Your session has expired or is invalid. Please log in again."
        );
      }

      if (response.status === 403) {
        throw new Error(
          data.message || "Your account does not have permission for this action."
        );
      }

      throw new Error(
        data.message || `Request failed (${response.status}).`
      );
    }

    return data;
  }, []);

  const loadState = useCallback(async () => {
    setLoading(true);
    setMessage("");

    try {
      let savedUser = {};

      try {
        savedUser = JSON.parse(
          localStorage.getItem("authUser") || "{}"
        );
      } catch {
        savedUser = {};
      }

      const currentRole = String(savedUser.role || "")
        .trim()
        .toLowerCase();

      setRole(currentRole);

      if (!token()) {
        setMessage("Please log in to access attendance.");
        return;
      }

      if (currentRole === "employee") {
        // Employees can access their own attendance.
        const me = await api("/attendance/me/today");

        setToday(me.attendance || null);
        setOffice(null);
        return;
      }

      if (currentRole === "admin" || currentRole === "hr") {
        // HR and admin can view office settings.
        const config = await api("/attendance/office-location");

        const location = config.officeLocation || null;

        setOffice(location);
        setAdminLat(
          location?.latitude == null
            ? ""
            : String(location.latitude)
        );
        setAdminLng(
          location?.longitude == null
            ? ""
            : String(location.longitude)
        );
        setRadius(String(location?.radiusMeters ?? 150));
        return;
      }

      setMessage(
        "Your account role is missing or unsupported. Please log in again or contact your administrator."
      );
    } catch (error) {
      setMessage(error.message || "Unable to load attendance.");
    } finally {
      setLoading(false);
    }
  }, [api]);

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }

    if (detectorRef.current) {
      try {
        detectorRef.current.close();
      } catch {
        // Detector may already be closed.
      }
      detectorRef.current = null;
    }

    setCameraReady(false);
    setFaceCount(0);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    loadState();

    return () => {
      mountedRef.current = false;

      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }

      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }

      if (detectorRef.current) {
        try {
          detectorRef.current.close();
        } catch {
          // Ignore cleanup errors.
        }
        detectorRef.current = null;
      }
    };
  }, [loadState]);

  const startCamera = async () => {
    setCameraError("");
    setMessage("");

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          "Camera access requires HTTPS or localhost and a supported browser."
        );
      }

      // Request camera access first so camera permission errors are clearer.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
      });

      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;

      if (!videoRef.current) {
        throw new Error("Camera preview is not available.");
      }

      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      const vision = await import("@mediapipe/tasks-vision");

      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        return;
      }

      const fileset = await vision.FilesetResolver.forVisionTasks(
        `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`
      );

      const detector = await vision.FaceDetector.createFromOptions(
        fileset,
        {
          baseOptions: {
            modelAssetPath: MODEL_URL,
            delegate: "CPU",
          },
          runningMode: "VIDEO",
          minDetectionConfidence: 0.6,
        }
      );

      if (!mountedRef.current) {
        detector.close();
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        return;
      }

      detectorRef.current = detector;
      lastDetectRef.current = 0;
      setCameraReady(true);

      const detect = (now) => {
        if (
          !mountedRef.current ||
          !videoRef.current ||
          !detectorRef.current ||
          !streamRef.current
        ) {
          return;
        }

        if (
          now - lastDetectRef.current > 250 &&
          videoRef.current.readyState >= 2
        ) {
          lastDetectRef.current = now;

          try {
            const result = detectorRef.current.detectForVideo(
              videoRef.current,
              now
            );

            setFaceCount(result.detections?.length || 0);
          } catch {
            setFaceCount(0);
          }
        }

        rafRef.current = requestAnimationFrame(detect);
      };

      rafRef.current = requestAnimationFrame(detect);
    } catch (error) {
      stopCamera();

      setCameraError(
        error.message || "Could not start the camera or face detector."
      );
    }
  };

  const getLocation = () =>
    new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(
          new Error("This browser does not support GPS location.")
        );
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracyMeters: position.coords.accuracy,
          });
        },
        (error) => {
          let message;

          if (error.code === 1) {
            message =
              "Location permission was denied. Allow location access in your browser settings.";
          } else if (error.code === 2) {
            message =
              "Your location is unavailable. Turn on device location and try again.";
          } else {
            message =
              "Location request timed out. Try again where GPS reception is better.";
          }

          reject(new Error(message));
        },
        {
          enableHighAccuracy: true,
          timeout: 20000,
          maximumAge: 0,
        }
      );
    });

  const markAttendance = async (action) => {
    if (busy) return;

    setBusy(true);
    setMessage("");

    try {
      if (!token()) {
        throw new Error("Please log in before recording attendance.");
      }

      if (role !== "employee") {
        throw new Error("Only employees can check in or check out.");
      }

      if (!cameraReady) {
        throw new Error("Start the camera before recording attendance.");
      }

      if (faceCount !== 1) {
        throw new Error(
          "Exactly one face must be visible in the camera."
        );
      }

      if (action === "check-in" && today?.checkInAt) {
        throw new Error("You have already checked in today.");
      }

      if (
        action === "check-out" &&
        (!today?.checkInAt || today?.checkOutAt)
      ) {
        throw new Error(
          "You must have an active check-in before checking out."
        );
      }

      const location = await getLocation();

      if (location.accuracyMeters > 100) {
        throw new Error(
          `GPS accuracy is ${Math.round(
            location.accuracyMeters
          )} m. The requirement is 100 m or better.`
        );
      }

      const result = await api(`/attendance/${action}`, {
        method: "POST",
        body: JSON.stringify({
          ...location,
          source: "camera",
          faceCount,
        }),
      });

      setToday(result.attendance || null);
      setMessage(result.message || "Attendance recorded successfully.");
    } catch (error) {
      setMessage(error.message || "Attendance could not be recorded.");
    } finally {
      setBusy(false);
    }
  };

  const saveOffice = async (event) => {
    event.preventDefault();

    if (busy) return;

    setBusy(true);
    setMessage("");

    try {
      if (role !== "admin") {
        throw new Error("Only administrators can change office settings.");
      }

      if (!token()) {
        throw new Error("Please log in again.");
      }

      const latitude = Number(adminLat);
      const longitude = Number(adminLng);
      const radiusMeters = Number(radius);

      if (
        !Number.isFinite(latitude) ||
        latitude < -90 ||
        latitude > 90 ||
        !Number.isFinite(longitude) ||
        longitude < -180 ||
        longitude > 180 ||
        !Number.isFinite(radiusMeters) ||
        radiusMeters < 25 ||
        radiusMeters > 5000
      ) {
        throw new Error(
          "Enter valid coordinates and a radius between 25 and 5000 metres."
        );
      }

      const result = await api("/attendance/office-location", {
        method: "PUT",
        body: JSON.stringify({
          latitude,
          longitude,
          radiusMeters,
          timezone: "Asia/Karachi",
          officeStart: "09:00",
          graceMinutes: 15,
        }),
      });

      setOffice(result.settings?.officeLocation || {
        latitude,
        longitude,
        radiusMeters,
      });

      setMessage(
        result.message || "Office location saved successfully."
      );
    } catch (error) {
      setMessage(error.message || "Unable to save office location.");
    } finally {
      setBusy(false);
    }
  };

  const useCurrentLocationForOffice = async () => {
    setMessage("");

    try {
      if (role !== "admin") {
        throw new Error(
          "Only administrators can configure the office location."
        );
      }

      const location = await getLocation();

      setAdminLat(String(location.latitude));
      setAdminLng(String(location.longitude));

      setMessage(
        `Current location read with GPS accuracy ${Math.round(
          location.accuracyMeters
        )} m. Confirm this is the office location before saving.`
      );
    } catch (error) {
      setMessage(error.message || "Unable to read current location.");
    }
  };

  return (
    <main className="attendance-shell">
      <header className="attendance-header">
        <div>
          <p className="eyebrow">HCM Lite · M4 Attendance</p>
          <h1>Camera check-in</h1>
          <p className="muted">
            Attendance requires one detected face, acceptable GPS accuracy,
            and a location inside the administrator-configured office radius.
          </p>
        </div>

        <a href="/dashboard">Back to dashboard</a>
      </header>

      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}

      {loading && (
        <section className="attendance-card">
          <p className="muted">Loading attendance...</p>
        </section>
      )}

      {!loading && role === "admin" && (
        <section className="attendance-card">
          <h2>Office location settings</h2>

          <p className="muted">
            Use the current device location only if you are physically at
            the office. Verify the coordinates before saving.
          </p>

          <form onSubmit={saveOffice} className="settings-grid">
            <label>
              Office latitude
              <input
                required
                type="number"
                step="any"
                min="-90"
                max="90"
                value={adminLat}
                onChange={(event) => setAdminLat(event.target.value)}
              />
            </label>

            <label>
              Office longitude
              <input
                required
                type="number"
                step="any"
                min="-180"
                max="180"
                value={adminLng}
                onChange={(event) => setAdminLng(event.target.value)}
              />
            </label>

            <label>
              Radius (metres)
              <input
                required
                min="25"
                max="5000"
                type="number"
                value={radius}
                onChange={(event) => setRadius(event.target.value)}
              />
            </label>

            <div className="button-row">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={useCurrentLocationForOffice}
              >
                Use this device’s location
              </button>

              <button type="submit" disabled={busy}>
                {busy ? "Saving..." : "Save office location"}
              </button>
            </div>
          </form>

          {office?.latitude != null && (
            <p className="muted">
              Saved: {office.latitude}, {office.longitude} · radius{" "}
              {office.radiusMeters} m
            </p>
          )}
        </section>
      )}

      {!loading && role === "employee" && (
        <section className="attendance-layout">
          <div className="attendance-card camera-card">
            <div className="video-frame">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                aria-label="Live camera preview"
              />

              {!cameraReady && (
                <div className="video-placeholder">
                  Camera preview appears here
                </div>
              )}

              <span
                className={`face-pill ${
                  cameraReady && faceCount === 1 ? "good" : "warn"
                }`}
              >
                {cameraReady
                  ? `${faceCount} face${
                      faceCount === 1 ? "" : "s"
                    } detected`
                  : "Camera off"}
              </span>
            </div>

            <p className="muted">
              The camera performs live face detection. This implementation
              does not upload or store the camera image, and does not verify
              the detected face against an employee identity.
            </p>

            {cameraError && (
              <p className="error-text" role="alert">
                {cameraError}
              </p>
            )}

            <div className="button-row">
              {!cameraReady ? (
                <button onClick={startCamera} disabled={busy}>
                  Start camera
                </button>
              ) : (
                <button
                  className="secondary"
                  onClick={stopCamera}
                  disabled={busy}
                >
                  Stop camera
                </button>
              )}
            </div>

            <div className="button-row">
              <button
                disabled={
                  busy ||
                  !cameraReady ||
                  faceCount !== 1 ||
                  !!today?.checkInAt
                }
                onClick={() => markAttendance("check-in")}
              >
                {busy ? "Please wait..." : "Check in"}
              </button>

              <button
                className="secondary"
                disabled={
                  busy ||
                  !cameraReady ||
                  faceCount !== 1 ||
                  !today?.checkInAt ||
                  !!today?.checkOutAt
                }
                onClick={() => markAttendance("check-out")}
              >
                Check out
              </button>
            </div>
          </div>

          <aside className="attendance-card">
            <h2>Today’s attendance</h2>

            {today ? (
              <dl className="attendance-details">
                <dt>Status</dt>
                <dd>{today.status || "Recorded"}</dd>

                <dt>Check-in</dt>
                <dd>
                  {today.checkInAt
                    ? new Date(today.checkInAt).toLocaleTimeString()
                    : "Not checked in"}
                </dd>

                <dt>Check-out</dt>
                <dd>
                  {today.checkOutAt
                    ? new Date(today.checkOutAt).toLocaleTimeString()
                    : "Not checked out"}
                </dd>

                <dt>Worked</dt>
                <dd>
                  {today.workedMinutes == null
                    ? "—"
                    : `${Math.floor(
                        today.workedMinutes / 60
                      )} h ${today.workedMinutes % 60} min`}
                </dd>
              </dl>
            ) : (
              <p className="muted">
                No check-in recorded today.
              </p>
            )}

            <h3>Before you check in</h3>
            <ul>
              <li>Allow camera and location permissions.</li>
              <li>Keep exactly one face in the frame.</li>
              <li>GPS accuracy must be 100 m or better.</li>
              <li>Be within the configured office radius.</li>
            </ul>
          </aside>
        </section>
      )}

      {!loading && role === "hr" && (
        <section className="attendance-card">
          <h2>Attendance</h2>
          <p className="muted">
            HR can view office settings here. Use the HR dashboard or
            attendance board to review employee attendance.
          </p>

          {office?.latitude != null && (
            <p className="muted">
              Office: {office.latitude}, {office.longitude} · radius{" "}
              {office.radiusMeters} m
            </p>
          )}
        </section>
      )}

      {!loading &&
        role !== "employee" &&
        role !== "admin" &&
        role !== "hr" && (
          <section className="attendance-card">
            <h2>Attendance</h2>
            <p className="muted">
              Your account role is not recognized. Please log in again
              or contact your administrator.
            </p>
          </section>
        )}
    </main>
  );
}
