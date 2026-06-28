/**
 * Message model - one document per LinkedIn message.
 *
 * Natural key: (threadUrn, messageUrn) so re-scrapes upsert idempotently.
 * `scrapedAt` is the wall-clock time of the most recent upsert so we can
 * tell "new since last scrape" by comparing against the prior value.
 */

import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const MessageSchema = new Schema(
  {
    /** LinkedIn thread URN (e.g. "2-...|rLZ...") the message belongs to. */
    threadUrn: { type: String, required: true, index: true },

    /** LinkedIn message URN (or the synthetic id we use when the real URN is missing). */
    messageUrn: { type: String, required: true },

    /** Display name of the other participant; used to label the thread in the UI. */
    conversationName: { type: String, required: true },

    /** LinkedIn profile URL of the other participant, if known. */
    conversationUrl: { type: String, default: '' },

    /** 'inbound' = from the other person, 'outbound' = sent by the logged-in user. */
    direction: { type: String, enum: ['inbound', 'outbound'], required: true },

    /** Display name of the sender (as LinkedIn renders it). */
    senderName: { type: String, required: true },

    /** Plain-text body of the message; <br> boundaries already collapsed to \n. */
    content: { type: String, required: true, default: '' },

    /** Time-of-day string LinkedIn shows (e.g. "3:07 PM"). */
    timestamp: { type: String, default: '' },

    /** LinkedIn day-divider text (e.g. "Friday") or null. */
    dateHeading: { type: String, default: null },

    edited: { type: Boolean, default: false },
    reactions: { type: [String], default: [] },

    /** When this row was last written (i.e. last time the extension saw the message). */
    scrapedAt: { type: Date, default: () => new Date(), index: true },

    /** When the original message was sent (best effort from LinkedIn's UI). */
    sentAt: { type: Date, default: null },
  },
  {
    // Avoid the pluralised collection name (mongoose would default to
    // "messages" - that's fine, but be explicit).
    collection: 'messages',
    strict: 'throw',
    timestamps: true,
  },
);

// Compound unique index for the natural key. upsert by (threadUrn, messageUrn).
MessageSchema.index({ threadUrn: 1, messageUrn: 1 }, { unique: true });

export type MessageDoc = InferSchemaType<typeof MessageSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const Message = mongoose.model('Message', MessageSchema);
