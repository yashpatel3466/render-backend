import mongoose from "mongoose";

const complaintSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  category: {
    type: String,
    required: true,
    enum: [
      "Road Repair",
      "Water Supply",
      "Electricity",
      "Waste Management",
      "Street Lighting",
      "Drainage",
      "Parks & Recreation",
      "Public Safety",
      "Other"
    ]
  },
  location: {
    address: {
      type: String,
      required: true
    },
    latitude: {
      type: Number,
      required: true
    },
    longitude: {
      type: Number,
      required: true
    }
  },
  images: [{
    type: String // URLs or base64
  }],
  photoVerification: {
    status: {
      type: String,
      enum: ["unchecked", "verified", "suspicious", "missing_gps", "error"],
      default: "unchecked"
    },
    distanceMeters: {
      type: Number
    },
    photoLatitude: {
      type: Number
    },
    photoLongitude: {
      type: Number
    },
    checkedAt: {
      type: Date
    },
    reason: {
      type: String
    }
  },
  status: {
    type: String,
    enum: ["pending", "assigned", "in_progress", "resolved", "rejected", "escalated"],
    default: "pending"
  },
  priority: {
    type: String,
    enum: ["pending", "low", "medium", "high", "urgent"],
    default: "pending"
  },
  reportedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null
  },
  assignedTechnicians: [{
    technician: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    assignedAt: {
      type: Date,
      default: Date.now
    },
    status: {
      type: String,
      enum: ["pending", "quoted", "rejected", "selected", "assigned"],
      default: "pending"
    }
  }],
  quotations: [{
    technician: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    amount: {
      type: Number,
      required: true
    },
    estimatedDays: {
      type: Number,
      required: true
    },
    description: {
      type: String,
      required: true
    },
    quotedAt: {
      type: Date,
      default: Date.now
    },
    status: {
      type: String,
      enum: ["pending", "assigned", "rejected"],
      default: "pending"
    }
  }],
  selectedQuotation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User" // Reference to the selected technician
  },
  slaDeadline: {
    type: Date
  },
  resolvedAt: {
    type: Date
  },
  resolutionNotes: {
    type: String
  },
  adminNotes: {
    type: String
  },
  progressUpdate: {
    image: { type: String },
    location: {
      latitude: { type: Number },
      longitude: { type: Number }
    },
    distanceMeters: { type: Number },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "none"],
      default: "none"
    },
    technician: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    submittedAt: { type: Date },
    resolutionNotes: { type: String },
    adminNotes: { type: String }
  }
}, { timestamps: true });

// Auto-calculate SLA deadline based on priority
// complaintSchema.pre("save", function(next) {
//   if (this.isNew && !this.slaDeadline) {
//     const now = new Date();
//     const slaDays = {
//       urgent: 1,
//       high: 3,
//       medium: 7,
//       low: 14
//     };
//     this.slaDeadline = new Date(now.getTime() + slaDays[this.priority] * 24 * 60 * 60 * 1000);
//   }
//   next();
// });

export default mongoose.model("Complaint", complaintSchema);

