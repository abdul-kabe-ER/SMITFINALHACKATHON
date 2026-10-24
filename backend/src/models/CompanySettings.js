import mongoose from "mongoose";

const companySettingsSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, default: "company" },
    timezone: { type: String, default: "Asia/Karachi" },
    officeStart: { type: String, default: "09:00" },
    graceMinutes: { type: Number, default: 15 },
    officeLocation: {
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
      radiusMeters: { type: Number, default: 150 },
    },
  },
  { timestamps: true }
);

export default mongoose.models.CompanySettings ||
  mongoose.model("CompanySettings", companySettingsSchema);
