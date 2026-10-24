import { Router } from "express";
import mongoose from "mongoose";
import Course from "../models/Course.js";
import User from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

function shapeCourse(course, userId) {
  const data = course.toObject ? course.toObject() : course;
  const completed = data.topics.filter(t => (t.completedBy || []).some(id => String(id) === String(userId))).length;
  return {
    ...data,
    progress: data.topics.length ? Math.round(completed / data.topics.length * 100) : 0,
    completedTopics: completed,
    topicCount: data.topics.length,
    isTeacher: String(data.teacher?._id || data.teacher) === String(userId),
    isEnrolled: (data.students || []).some(s => String(s?._id || s) === String(userId))
  };
}

// Teacher sees courses they teach; students see courses they are enrolled in.
router.get("/", async (req, res) => {
  try {
    const filter = req.user.role === "teacher" ? { teacher: req.user._id } : { students: req.user._id };
    const courses = await Course.find(filter).populate("teacher", "name email").populate("students", "name email").sort({ createdAt: -1 });
    res.json({ courses: courses.map(c => shapeCourse(c, req.user._id)) });
  } catch (error) {
    console.error("List courses error:", error);
    res.status(500).json({ message: "Unable to load courses." });
  }
});

router.get("/available", async (req, res) => {
  try {
    if (req.user.role !== "student") return res.status(403).json({ message: "Only students can browse available courses." });
    const courses = await Course.find({ students: { $ne: req.user._id } }).populate("teacher", "name email").sort({ name: 1 });
    res.json({ courses: courses.map(c => shapeCourse(c, req.user._id)) });
  } catch (error) {
    console.error("Available courses error:", error);
    res.status(500).json({ message: "Unable to load available courses." });
  }
});

router.post("/", async (req, res) => {
  try {
    if (req.user.role !== "teacher") return res.status(403).json({ message: "Only teachers can create courses." });
    const name = String(req.body?.name || "").trim();
    const description = String(req.body?.description || "").trim();
    if (name.length < 2 || name.length > 120) return res.status(400).json({ message: "Course name must be 2–120 characters." });
    const course = await Course.create({ name, description, teacher: req.user._id });
    await course.populate("teacher", "name email");
    res.status(201).json({ course: shapeCourse(course, req.user._id) });
  } catch (error) {
    console.error("Create course error:", error);
    res.status(500).json({ message: "Unable to create course." });
  }
});

router.post("/:id/enroll", async (req, res) => {
  try {
    if (req.user.role !== "student") return res.status(403).json({ message: "Only students can enroll in courses." });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid course ID." });
    const course = await Course.findByIdAndUpdate(req.params.id, { $addToSet: { students: req.user._id } }, { new: true })
      .populate("teacher", "name email").populate("students", "name email");
    if (!course) return res.status(404).json({ message: "Course not found." });
    res.json({ message: "Enrolled successfully.", course: shapeCourse(course, req.user._id) });
  } catch (error) {
    console.error("Enroll error:", error);
    res.status(500).json({ message: "Unable to enroll in this course." });
  }
});

router.post("/:id/topics", async (req, res) => {
  try {
    if (req.user.role !== "teacher") return res.status(403).json({ message: "Only teachers can add topics." });
    const title = String(req.body?.title || "").trim();
    const description = String(req.body?.description || "").trim();
    if (title.length < 2 || title.length > 160) return res.status(400).json({ message: "Topic title must be 2–160 characters." });
    const course = await Course.findOne({ _id: req.params.id, teacher: req.user._id });
    if (!course) return res.status(404).json({ message: "Course not found in your teaching list." });
    course.topics.push({ title, description, order: course.topics.length });
    await course.save();
    res.status(201).json({ course: shapeCourse(course, req.user._id) });
  } catch (error) {
    console.error("Add topic error:", error);
    res.status(500).json({ message: "Unable to add topic." });
  }
});

router.patch("/:id/topics/:topicId/complete", async (req, res) => {
  try {
    if (!["teacher", "student"].includes(req.user.role)) return res.status(403).json({ message: "Not permitted." });
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ message: "Course not found." });
    const isTeacher = String(course.teacher) === String(req.user._id);
    const isStudent = course.students.some(id => String(id) === String(req.user._id));
    if ((req.user.role === "teacher" && !isTeacher) || (req.user.role === "student" && !isStudent)) {
      return res.status(403).json({ message: "You do not have access to this course." });
    }
    const topic = course.topics.id(req.params.topicId);
    if (!topic) return res.status(404).json({ message: "Topic not found." });
    topic.completedBy = topic.completedBy || [];
    const done = req.body?.completed !== false;
    const has = topic.completedBy.some(id => String(id) === String(req.user._id));
    if (done && !has) topic.completedBy.push(req.user._id);
    if (!done && has) topic.completedBy = topic.completedBy.filter(id => String(id) !== String(req.user._id));
    await course.save();
    res.json({ course: shapeCourse(course, req.user._id) });
  } catch (error) {
    console.error("Complete topic error:", error);
    res.status(500).json({ message: "Unable to update topic progress." });
  }
});

router.get("/:id/students", async (req, res) => {
  try {
    if (req.user.role !== "teacher") return res.status(403).json({ message: "Only teachers can view enrolled students." });
    const course = await Course.findOne({ _id: req.params.id, teacher: req.user._id }).populate("students", "name email createdAt");
    if (!course) return res.status(404).json({ message: "Course not found." });
    res.json({ students: course.students });
  } catch (error) {
    console.error("Students list error:", error);
    res.status(500).json({ message: "Unable to load enrolled students." });
  }
});

export default router;
