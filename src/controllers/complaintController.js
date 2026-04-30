import Complaint from "../models/Complaint.js";
import User from "../models/User.js";
import {
  downloadImageToBuffer,
  extractGpsFromImageBuffer,
  haversineDistanceMeters
} from "../utils/photoLocation.js";

// Helper to check for overdue complaints
const checkOverdueComplaints = async () => {
  const now = new Date();
  const deadlines = {
    low: 8 * 24 * 60 * 60 * 1000,    // 192 hours
    medium: 5 * 24 * 60 * 60 * 1000, // 120 hours
    high: 3 * 24 * 60 * 60 * 1000,   // 72 hours
    urgent: 2 * 24 * 60 * 60 * 1000  // 48 hours
  };

  try {
    // Find all active complaints (not resolved, rejected, or already escalated)
    const activeComplaints = await Complaint.find({
      status: { $nin: ["resolved", "rejected", "escalated"] }
    });

    let updateCount = 0;

    for (const complaint of activeComplaints) {
      const priority = complaint.priority || "pending";
      if (priority === "pending") continue;

      const timeLimit = deadlines[priority];
      if (!timeLimit) continue; // Should not happen if priority is valid

      // Use reported date (createdAt)
      const elapsed = now - new Date(complaint.createdAt);

      if (elapsed > timeLimit) {
        complaint.status = "escalated";
        // Also update resolution notes for clarity
        if (!complaint.resolutionNotes) {
          complaint.resolutionNotes = `Automatically escalated due to missed deadline for ${priority} priority.`;
        }
        await complaint.save();
        updateCount++;
        console.log(`Escalated complaint ${complaint._id}: Priority ${priority}, Elapsed ${elapsed / 3600000}h > Limit ${timeLimit / 3600000}h`);
      }
    }

    if (updateCount > 0) {
      console.log(`Checked overdue complaints: Escalated ${updateCount} complaints.`);
    }
  } catch (error) {
    console.error("Error checking overdue complaints:", error);
  }
};

// Create complaint (User only)
export const createComplaint = async (req, res) => {
  try {
    const {
      title,
      description,
      category,
      location,
      images,
      priority
    } = req.body;

    console.log("Creating complaint - Body Priority:", priority, "Resolved Priority:", priority || "pending"); // DEBUG LOG

    if (!title || !description || !category || !location) {
      return res.status(400).json({ message: "All required fields must be provided" });
    }

    if (!location.latitude || !location.longitude || !location.address) {
      return res.status(400).json({ message: "Complete location information required" });
    }

    // Photo location verification (mandatory, only if an image is provided and it contains EXIF GPS)
    const maxDistanceMeters = Number(process.env.PHOTO_GPS_MAX_DISTANCE_METERS || 500);
    let photoVerification = { status: "unchecked" };

    // Check daily complaint limit (max 3 complaints per 24 hours)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const complaintsLast24Hours = await Complaint.countDocuments({
      reportedBy: req.user._id,
      createdAt: { $gte: twentyFourHoursAgo }
    });

    if (complaintsLast24Hours >= 3) {
      return res.status(429).json({
        message: "Daily limit exceeded: You can file maximum 3 complaints per 24 hours. Please try again tomorrow."
      });
    }

    const complaintLat = Number(location.latitude);
    const complaintLon = Number(location.longitude);

    if (!Array.isArray(images) || images.length === 0) {
      return res.status(400).json({
        message: "Photo verification failed: At least one photo with GPS location is required for complaint submission. Please take a photo at the complaint location with location services enabled."
      });
    }

    if (!Number.isFinite(complaintLat) || !Number.isFinite(complaintLon)) {
      return res.status(400).json({
        message: "Photo verification failed: Valid complaint location coordinates are required."
      });
    }

    // Try images in order; validate against first one that contains GPS
    for (const imageRef of images) {
      try {
        const buf = await downloadImageToBuffer(imageRef);
        const gps = await extractGpsFromImageBuffer(buf);
        if (!gps) {
          // No GPS in this image; reject complaint for security
          return res.status(400).json({
            message: "Photo verification failed: No GPS location found in uploaded image. Please enable location services on your camera and take a new photo at the complaint location.",
            photoVerification: {
              status: "missing_gps",
              checkedAt: new Date(),
              reason: "No GPS metadata found in uploaded image - mandatory for complaint submission"
            }
          });
        }

        const distanceMeters = haversineDistanceMeters(
          complaintLat,
          complaintLon,
          gps.latitude,
          gps.longitude
        );

        if (distanceMeters == null) {
          photoVerification = {
            status: "error",
            checkedAt: new Date(),
            reason: "Failed to compute distance from image GPS"
          };
          break;
        }

        // If too far, reject and ask user to upload correct image
        if (distanceMeters > maxDistanceMeters) {
          return res.status(400).json({
            message: `Photo verification failed: Image location is ${Math.round(distanceMeters)}m away from complaint location. Maximum allowed distance is ${maxDistanceMeters}m. Please take a photo at the actual complaint location.`,
            photoVerification: {
              status: "suspicious",
              checkedAt: new Date(),
              distanceMeters,
              maxDistanceMetersAllowed: maxDistanceMeters,
              complaintLocation: { latitude: complaintLat, longitude: complaintLon },
              photoLocation: { latitude: gps.latitude, longitude: gps.longitude }
            }
          });
        }

        photoVerification = {
          status: "verified",
          checkedAt: new Date(),
          distanceMeters,
          photoLatitude: gps.latitude,
          photoLongitude: gps.longitude
        };
        break; // verified against one image; done
      } catch (e) {
        // Don't break complaint creation if EXIF parsing/download fails; record best-effort status.
        photoVerification = {
          status: "error",
          checkedAt: new Date(),
          reason: e?.message || "Photo verification failed"
        };
        break;
      }
    }

    const complaint = await Complaint.create({
      title,
      description,
      category,
      location,
      images: images || [],
      photoVerification,
      priority: priority || "pending",
      reportedBy: req.user._id
    });

    res.status(201).json({
      message: "Complaint submitted successfully",
      complaint
    });
  } catch (error) {
    console.error("Create complaint error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Get all complaints (with filters)
export const getComplaints = async (req, res) => {
  try {
    // Check for escalations first
    await checkOverdueComplaints();

    const { status, category, priority, department, assignedTo } = req.query;
    const filter = {};

    // Role-based filtering
    if (req.user.role === "user") {
      // Helper for heatmap: allow fetching all complaints if scope can be verified as public data intent
      if (req.query.scope !== "global") {
        filter.reportedBy = req.user._id;
      }
    } else if (req.user.role === "technician") {
      filter["assignedTechnicians.technician"] = req.user._id;
    }

    if (status) filter.status = status;
    if (category) filter.category = category;
    if (priority) filter.priority = priority;

    if (assignedTo) {
      filter.assignedTo = assignedTo;
    }

    const complaints = await Complaint.find(filter)
      .populate("reportedBy", "name email")
      .populate("assignedTo", "name email")
      .populate("assignedTechnicians.technician", "name email")
      .populate("quotations.technician", "name email")
      .populate("progressUpdate.technician", "name email") // Added population for progress update
      .sort({ createdAt: -1 });

    res.json({ complaints });
  } catch (error) {
    console.error("Get complaints error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Get single complaint
export const getComplaint = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || id === 'undefined' || id === 'null') {
      return res.status(400).json({ message: "Invalid complaint ID" });
    }

    const complaint = await Complaint.findById(id)
      .populate("reportedBy", "name email")
      .populate("assignedTo", "name email")
      .populate("assignedTechnicians.technician", "name email")
      .populate("quotations.technician", "name email")
      .populate("progressUpdate.technician", "name email");

    if (!complaint) {
      return res.status(404).json({ message: "Complaint not found" });
    }

    // Check access
    if (req.user.role === "user" && complaint.reportedBy._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Access denied" });
    }

    res.json({ complaint });
  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(400).json({ message: "Invalid complaint ID format" });
    }
    console.error("Get complaint error stack:", error.stack);
    console.error("Get complaint error message:", error.message);
    res.status(500).json({ message: "Server error: " + error.message });
  }
};

// Update complaint status (Admin/Technician)
export const updateComplaintStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, resolutionNotes, adminNotes } = req.body;

    const complaint = await Complaint.findById(id);
    if (!complaint) {
      return res.status(404).json({ message: "Complaint not found" });
    }

    // Check permissions
    if (req.user.role === "technician" && complaint.assignedTo?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not assigned to you" });
    }

    const updateData = {};
    if (status) updateData.status = status;
    if (resolutionNotes) updateData.resolutionNotes = resolutionNotes;
    if (req.body.priority) updateData.priority = req.body.priority; // Allow updating priority
    if (adminNotes && req.user.role === "admin") updateData.adminNotes = adminNotes;

    if (status === "resolved") {
      updateData.resolvedAt = new Date();
    }

    const updatedComplaint = await Complaint.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    ).populate("reportedBy", "name email")
      .populate("assignedTo", "name email");

    res.json({
      message: "Complaint updated successfully",
      complaint: updatedComplaint
    });
  } catch (error) {
    console.error("Update complaint error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Assign complaint to technician (Admin only)
export const assignComplaint = async (req, res) => {
  try {
    const { id } = req.params;
    const { technicianId } = req.body;

    if (!technicianId) {
      return res.status(400).json({ message: "Technician ID required" });
    }

    const technician = await User.findById(technicianId);
    if (!technician || technician.role !== "technician") {
      return res.status(400).json({ message: "Invalid technician" });
    }

    const complaint = await Complaint.findByIdAndUpdate(
      id,
      {
        assignedTo: technicianId,
        status: "assigned"
      },
      { new: true }
    ).populate("reportedBy", "name email")
      .populate("assignedTo", "name email");

    if (!complaint) {
      return res.status(404).json({ message: "Complaint not found" });
    }

    res.json({
      message: "Complaint assigned successfully",
      complaint
    });
  } catch (error) {
    console.error("Assign complaint error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Assign complaint to multiple technicians (Admin only)
export const assignMultipleTechnicians = async (req, res) => {
  try {
    const { id } = req.params;
    const { technicianIds } = req.body;

    if (!technicianIds || !Array.isArray(technicianIds) || technicianIds.length === 0) {
      return res.status(400).json({ message: "Please select at least one technician" });
    }

    const complaint = await Complaint.findById(id);
    if (!complaint) {
      return res.status(404).json({ message: "Complaint not found" });
    }

    // Clear previous assignments and add new ones
    complaint.assignedTechnicians = technicianIds.map(techId => ({
      technician: techId,
      assignedAt: new Date(),
      status: "pending"
    }));

    await complaint.save();

    // Populate technician details for response
    await complaint.populate("assignedTechnicians.technician", "name email");

    res.json({
      message: "Complaint assigned to technicians successfully",
      complaint
    });
  } catch (error) {
    console.error("Assign multiple technicians error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Select technician for quotation submission (Admin only)
export const selectTechnician = async (req, res) => {
  try {
    const { id } = req.params;
    const { technicianId } = req.body;

    const complaint = await Complaint.findById(id);
    if (!complaint) {
      return res.status(404).json({ message: "Complaint not found" });
    }

    // Find the technician assignment
    const technicianAssignment = complaint.assignedTechnicians.find(
      assignment => assignment.technician.toString() === technicianId
    );

    if (!technicianAssignment) {
      return res.status(404).json({ message: "Technician not found in assigned list" });
    }

    // Update all technician assignments
    complaint.assignedTechnicians.forEach(assignment => {
      if (assignment.technician.toString() === technicianId) {
        assignment.status = "selected";
      } else {
        assignment.status = "rejected";
      }
    });

    await complaint.save();

    // Populate technician details for response
    await complaint.populate("assignedTechnicians.technician", "name email");

    res.json({
      message: "Technician selected successfully",
      complaint
    });
  } catch (error) {
    console.error("Select technician error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Accept quotation and finalize assignment (Admin only)
export const acceptQuotation = async (req, res) => {
  try {
    const { id } = req.params;
    const { quotationId } = req.body;

    const complaint = await Complaint.findById(id);
    if (!complaint) {
      return res.status(404).json({ message: "Complaint not found" });
    }

    // Find the quotation
    const quotation = complaint.quotations.find(q => q._id.toString() === quotationId);
    if (!quotation) {
      console.log("Available quotations:", complaint.quotations.map(q => ({ _id: q._id, technician: q.technician })));
      console.log("Looking for quotationId:", quotationId);
      return res.status(404).json({ message: "Quotation not found" });
    }

    // Update all technician assignments
    complaint.assignedTechnicians.forEach(assignment => {
      if (assignment.technician.toString() === quotation.technician.toString()) {
        assignment.status = "assigned"; // Final assignment
      } else {
        assignment.status = "rejected";
      }
    });

    // Update all quotation statuses
    complaint.quotations.forEach(q => {
      if (q._id.toString() === quotationId) {
        q.status = "assigned"; // Selected quotation - changed from "accepted" to "assigned"
      } else {
        q.status = "rejected"; // Rejected quotations
      }
    });

    // Assign the complaint to the selected technician
    complaint.assignedTo = quotation.technician;
    complaint.status = "assigned";

    await complaint.save();

    // Populate all details for response
    await complaint.populate("assignedTechnicians.technician", "name email");
    await complaint.populate("assignedTo", "name email");
    await complaint.populate("quotations.technician", "name email");

    res.json({
      message: "Quotation accepted and technician assigned successfully",
      complaint
    });
  } catch (error) {
    console.error("Accept quotation error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Submit quotation (Technician only)
export const submitQuotation = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, estimatedDays, description } = req.body;

    if (!amount || !estimatedDays || !description) {
      return res.status(400).json({ message: "All quotation fields are required" });
    }

    const complaint = await Complaint.findById(id);
    if (!complaint) {
      return res.status(404).json({ message: "Complaint not found" });
    }

    // Check if technician is assigned (pending or selected)
    const technicianAssignment = complaint.assignedTechnicians.find(
      assignment => assignment.technician.toString() === req.user._id.toString()
    );

    if (!technicianAssignment) {
      return res.status(403).json({ message: "You are not assigned to this complaint" });
    }

    if (technicianAssignment.status !== "pending" && technicianAssignment.status !== "selected") {
      return res.status(403).json({ message: "You cannot submit quotation for this complaint" });
    }

    // Check if already quoted
    const existingQuotation = complaint.quotations.find(
      q => q.technician.toString() === req.user._id.toString()
    );

    if (existingQuotation) {
      return res.status(400).json({ message: "You have already submitted a quotation for this complaint" });
    }

    // Add quotation
    complaint.quotations.push({
      technician: req.user._id,
      amount: Number(amount),
      estimatedDays: Number(estimatedDays),
      description,
      status: "pending" // Explicitly set status for admin review
    });

    // Update technician assignment status
    technicianAssignment.status = "quoted";

    await complaint.save();

    res.json({
      message: "Quotation submitted successfully",
      complaint
    });
  } catch (error) {
    console.error("Submit quotation error:", error);
    res.status(500).json({ message: "Server error" });
  }
};


// Get statistics (Admin)
export const getStatistics = async (req, res) => {
  try {
    await checkOverdueComplaints();

    const totalComplaints = await Complaint.countDocuments();
    const pendingComplaints = await Complaint.countDocuments({ status: "pending" });
    const inProgressComplaints = await Complaint.countDocuments({ status: "in_progress" });
    const resolvedComplaints = await Complaint.countDocuments({ status: "resolved" });

    // Count escalated specifically
    const escalatedComplaints = await Complaint.countDocuments({ status: "escalated" });
    console.log("Escalated Count Check:", escalatedComplaints); // DEBUG LOG

    const complaintsByCategory = await Complaint.aggregate([
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 }
        }
      }
    ]);

    const complaintsByDepartment = await Complaint.aggregate([
      {
        $group: {
          _id: "$department",
          count: { $sum: 1 }
        }
      }
    ]);

    res.json({
      totalComplaints,
      pendingComplaints,
      inProgressComplaints,
      resolvedComplaints,
      escalatedComplaints,
      complaintsByCategory,
      complaintsByDepartment
    });
  } catch (error) {
    console.error("Get statistics error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Get statistics (Technician)
export const getTechnicianStats = async (req, res) => {
  try {
    const technicianId = req.user._id;

    // Count complaints assigned to this technician
    const assignedCount = await Complaint.countDocuments({
      "assignedTechnicians": {
        $elemMatch: {
          technician: technicianId,
          status: "assigned"
        }
      }
    });

    // Count complaints resolved by this technician (or where they were assigned and it's resolved)
    // A stricter check might be needed depending on workflow, but this is a good start
    const resolvedCount = await Complaint.countDocuments({
      "assignedTechnicians": {
        $elemMatch: {
          technician: technicianId,
          status: "assigned"
        }
      },
      status: "resolved"
    });

    // Count quotations sent by this technician
    const quotationCount = await Complaint.countDocuments({
      "quotations.technician": technicianId
    });

    res.json({
      assigned: assignedCount,
      resolved: resolvedCount,
      quotations: quotationCount
    });
  } catch (error) {
    console.error("Get technician stats error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Get technicians list (Admin)
export const getTechnicians = async (req, res) => {
  try {
    const technicians = await User.find({ role: "technician" })
      .select("name email _id");

    res.json({ technicians });
  } catch (error) {
    console.error("Get technicians error:", error);
    res.status(500).json({ message: "Server error" });
  }
};


// Submit progress update (Technician only)
export const submitProgressUpdate = async (req, res) => {
  try {
    const { id } = req.params;
    const { image, location, targetStatus, resolutionNotes } = req.body; // Added targetStatus and resolutionNotes

    if (!image || !location || !location.latitude || !location.longitude) {
      return res.status(400).json({ message: "Image and location are required" });
    }

    const complaint = await Complaint.findById(id);
    if (!complaint) {
      return res.status(404).json({ message: "Complaint not found" });
    }

    // Check if technician is assigned (final assignment)
    if (complaint.assignedTo?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "You are not assigned to this complaint" });
    }

    // Calculate distance
    const maxDistanceMeters = Number(process.env.PHOTO_GPS_MAX_DISTANCE_METERS || 500);
    const distance = haversineDistanceMeters(
      complaint.location.latitude,
      complaint.location.longitude,
      location.latitude,
      location.longitude
    );

    if (distance === null) {
      return res.status(400).json({ message: "Could not calculate distance" });
    }

    // Reject if too far
    if (distance > maxDistanceMeters) {
      return res.status(400).json({
        message: `Location verification failed: You are ${Math.round(distance)}m away from the complaint location. Tolerance is ${maxDistanceMeters}m.`
      });
    }

    complaint.progressUpdate = {
      image,
      location,
      distanceMeters: distance,
      status: "pending",
      targetStatus: targetStatus || "in_progress", // Default to in_progress if not provided
      technician: req.user._id,
      resolutionNotes, // Save the notes
      submittedAt: new Date(),
    };

    await complaint.save();

    res.json({
      message: "Progress update submitted for verification",
      complaint
    });
  } catch (error) {
    console.error("Submit progress update error:", error);
    res.status(500).json({ message: "Server error" });
  }
};


// Verify progress update (Admin only)
export const verifyProgressUpdate = async (req, res) => {
  try {
    const { id } = req.params;
    const { approved, notes } = req.body; // approved: boolean

    const complaint = await Complaint.findById(id)
      .populate("reportedBy", "name email")
      .populate("assignedTo", "name email")
      .populate("progressUpdate.technician", "name email");

    if (!complaint) {
      return res.status(404).json({ message: "Complaint not found" });
    }

    if (!complaint.progressUpdate || complaint.progressUpdate.status === "none") {
      return res.status(400).json({ message: "No progress update pending" });
    }

    if (approved) {
      complaint.progressUpdate.status = "approved";
      complaint.progressUpdate.adminNotes = notes;

      // Use targetStatus to determine the new status
      const newStatus = complaint.progressUpdate.targetStatus || "in_progress";
      complaint.status = newStatus;

      if (newStatus === "resolved") {
        complaint.resolvedAt = new Date();
        complaint.resolutionNotes = complaint.progressUpdate.resolutionNotes || notes || "Verified completion via photo.";
      }

    } else {
      complaint.progressUpdate.status = "rejected";
      complaint.progressUpdate.adminNotes = notes;
      // Status remains 'assigned' or previous status
    }

    await complaint.save();

    res.json({
      message: approved ? "Progress update approved" : "Progress update rejected",
      complaint
    });
  } catch (error) {
    console.error("Verify progress update error:", error);
    res.status(500).json({ message: "Server error" });
  }
};
