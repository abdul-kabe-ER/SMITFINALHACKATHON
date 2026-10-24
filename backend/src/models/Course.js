import mongoose from "mongoose";

const topicSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, trim: true, maxlength: 1000, default: "" },
  order: { type: Number, default: 0 },
  completedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }]
}, { timestamps: true });

const courseSchema = new mongoose.Schema({
  courseId: { type: String, unique: true, trim: true, uppercase: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, trim: true, maxlength: 1000, default: "" },
  teacher: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  topics: { type: [topicSchema], default: [] },
  students: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }]
}, { timestamps: true });

courseSchema.pre("validate", function(next) {
  if (!this.courseId && this.name) {
    this.courseId = `${this.name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20)}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  }
  next();
});

export default mongoose.model("Course", courseSchema);
