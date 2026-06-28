/**
 * Thread model - one document per LinkedIn conversation (DM thread).
 *
 * Aggregates per-thread metadata so the side panel can show the top-15
 * threads quickly without re-aggregating from the messages collection on
 * every page load.
 */

import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const ThreadSchema = new Schema(
  {
    /** LinkedIn thread URN, used as the natural key. */
    urn: { type: String, required: true, unique: true },

    /** Display name of the other participant. */
    conversationName: { type: String, required: true },

    /** LinkedIn profile URL of the other participant. */
    conversationUrl: { type: String, default: '' },

    /** Most-recent message preview, truncated. */
    lastInboundPreview: { type: String, default: '' },

    /** Most-recent message time-of-day string, or empty string. */
    lastMessageTime: { type: String, default: '' },

    /** True if the most recent message is inbound (i.e. we owe a reply). */
    lastMessageIsInbound: { type: Boolean, default: false },

    /** Counters maintained by the bulk-upsert route for quick side-panel rendering. */
    inboundCount: { type: Number, default: 0 },
    outboundCount: { type: Number, default: 0 },

    /** When we last wrote any of this thread's messages. */
    lastScrapedAt: { type: Date, default: () => new Date(), index: true },
  },
  {
    collection: 'threads',
    strict: 'throw',
    timestamps: true,
  },
);

export type ThreadDoc = InferSchemaType<typeof ThreadSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const Thread = mongoose.model('Thread', ThreadSchema);
