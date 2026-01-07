import { randomUUID } from 'crypto';
import { Schema, model, type InferSchemaType } from 'mongoose';

export const scheduleSchema = new Schema(
  {
    _id: { type: String, default: () => `sch_${randomUUID()}` },
    accountId: { type: String, required: true, index: true },
    service: { type: String, default: 'default' },
    ref: { type: String, default: '' },
    scheduleDate: { type: String, required: true },
    generateImages: { type: Boolean, default: false },
    imageCount: { type: Number, default: 0 },
    delayBetweenPostsSeconds: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
      default: 'pending',
      index: true,
    },
    totalJobs: { type: Number, default: 0 },
    completedJobs: { type: Number, default: 0 },
    failedJobs: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const scheduleJobSchema = new Schema(
  {
    _id: { type: String, default: () => `job_${randomUUID()}` },
    scheduleId: { type: String, required: true, index: true },
    keyword: { type: String, required: true },
    scheduledAt: { type: String, required: true, index: true },
    slot: { type: Number, required: true },
    generateJobId: { type: String },
    publishJobId: { type: String },
    manuscriptId: { type: String },
    postUrl: { type: String },
    status: {
      type: String,
      enum: ['pending', 'generating', 'generated', 'publishing', 'published', 'failed', 'cancelled'],
      default: 'pending',
    },
    error: { type: String },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

export type Schedule = InferSchemaType<typeof scheduleSchema>;
export type ScheduleJob = InferSchemaType<typeof scheduleJobSchema>;

export const ScheduleModel = model('Schedule', scheduleSchema);
export const ScheduleJobModel = model('ScheduleJob', scheduleJobSchema);
