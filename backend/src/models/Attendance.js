import mongoose from "mongoose";

const attendanceSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    dateKey: { type: String, required: true },
    checkInAt: { type: Date, required: true },
    checkOutAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ["present", "late", "half_day", "missing_checkout"],
      default: "present",
    },
    source: { type: String, enum: ["web", "camera"], required: true },
    checkInLocation: {
      latitude: Number,
      longitude: Number,
      accuracyMeters: Number,
      distanceMeters: Number,
    },
    checkOutLocation: {
      latitude: Number,
      longitude: Number,
      accuracyMeters: Number,
      distanceMeters: Number,
    },
    workedMinutes: { type: Number, default: null },
  },
  { timestamps: true }
);

// A person can only have one attendance record per local calendar day.
attendanceSchema.index({ employeeId: 1, dateKey: 1 }, { unique: true });

export default mongoose.models.Attendance ||
  mongoose.model("Attendance", attendanceSchema);
