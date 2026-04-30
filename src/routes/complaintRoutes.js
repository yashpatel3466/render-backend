import express from "express";
import {
  createComplaint,
  getComplaints,
  getComplaint,
  updateComplaintStatus,
  assignMultipleTechnicians,
  selectTechnician,
  acceptQuotation,
  submitQuotation,
  getStatistics,
  getTechnicians,
  submitProgressUpdate,
  verifyProgressUpdate,
  getTechnicianStats
} from "../controllers/complaintController.js";
import { authenticate, authorize } from "../middleware/authMiddleware.js";

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// User routes
router.post("/", authorize("user"), createComplaint);
router.get("/", getComplaints);
router.get("/stats/technician", authorize("technician"), getTechnicianStats); // Add this before /:id generic route
router.get("/:id", getComplaint);

// Admin routes
router.post("/:id/assign-multiple", authorize("admin"), assignMultipleTechnicians);
router.post("/:id/select-technician", authorize("admin"), selectTechnician);
router.post("/:id/accept-quotation", authorize("admin"), acceptQuotation);
router.get("/stats/overview", authorize("admin"), getStatistics);
router.get("/technicians/list", authorize("admin"), getTechnicians);

// Technician routes
router.post("/:id/submit-quotation", authorize("technician"), submitQuotation);

// Admin and Technician routes
router.put("/:id/status", authorize("admin", "technician"), updateComplaintStatus);

// Progress Update Routes
router.post("/:id/progress-update", authorize("technician"), submitProgressUpdate);
router.post("/:id/verify-progress", authorize("admin"), verifyProgressUpdate);

export default router;

