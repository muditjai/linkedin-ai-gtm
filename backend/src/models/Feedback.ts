/**
 * Feedback model - one document per user feedback on a draft reply.
 *
 * Per AGENTS.md "Feedback Storage" + "Model Fine-Tuning": we save each
 * piece of feedback so future model calls can use prior good/bad
 * examples for the same person / thread.
 */

import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const FeedbackSchema = new Schema(
  {
    /** Which thread the feedback is about. */
    threadUrn: { type: String, required: true, index: true },

    /** Which message we were drafting a reply to. */
    messageUrn: { type: String, default: '' },

    /** The draft we proposed (so the user can see what they were rating). */
    draft: { type: String, required: true, default: '' },

    /** Optional sentiment we observed at draft time. */
    sentiment: { type: String, default: '' },

    /** User score: 1 (bad) - 5 (great). Thumbs up/down maps to 5/1. */
    score: { type: Number, min: 1, max: 5, required: true },

    /** Free-text feedback. */
    comment: { type: String, default: '' },

    /** The model that produced the draft (e.g. "gemini-1.5-pro"). */
    model: { type: String, default: '' },
  },
  {
    collection: 'feedback',
    strict: 'throw',
    timestamps: true,
  },
);

export type FeedbackDoc = InferSchemaType<typeof FeedbackSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const Feedback = mongoose.model('Feedback', FeedbackSchema);
