import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, "Name is required"], trim: true, minlength: 2, maxlength: 80 },
    email: { type: String, required: [true, "Email is required"], unique: true, lowercase: true, trim: true, maxlength: 254 },
    password: { type: String, required: true, select: false },
    // student/teacher remain accepted so existing LMS accounts can still be read during migration.
    role: { type: String, enum: ["admin", "hr", "employee", "student", "teacher"], required: true, default: "employee" },
    employeeCode: { type: String, trim: true, uppercase: true, sparse: true, unique: true },
    department: { type: String, trim: true, default: "" },
    designation: { type: String, trim: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    address: { type: String, trim: true, default: "" },
    salary: { type: Number, min: 0, default: 0 },
    dateOfJoining: { type: Date, default: null },
    status: { type: String, enum: ["active", "probation", "inactive", "exited"], default: "active" },
    mustChangePassword: { type: Boolean, default: false }
  },
  { timestamps: true }
);

export default mongoose.models.User || mongoose.model("User", userSchema);
