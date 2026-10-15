import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Feedback, StoredFeedback } from '@hexxar/shared';

interface Saved {
  feedback: StoredFeedback[];
  /** The local date (YYYY-MM-DD) the daily email was last dealt with, so it is not sent twice. */
  lastDigest: string | null;
}

/**
 * Feedback kept in a JSON file: a few messages a day does not need a database. Everything is held in
 * memory and the file is rewritten (to a temporary file first, then moved over it) on every change.
 */
export class FeedbackStore {
  private data: Saved = { feedback: [], lastDigest: null };
  private writing: Promise<void> = Promise.resolve();
  private readonly file: string;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'feedback.json');
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Saved>;
      this.data = { feedback: saved.feedback ?? [], lastDigest: saved.lastDigest ?? null };
    } catch (error) {
      // A missing file is a fresh start; a damaged one must not be silently overwritten.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  /** Newest first. */
  list(): StoredFeedback[] {
    return [...this.data.feedback].reverse();
  }

  /** What has not been dealt with, oldest first. */
  open(): StoredFeedback[] {
    return this.data.feedback.filter((item) => item.resolvedAt === null);
  }

  get total(): number {
    return this.data.feedback.length;
  }

  get lastDigest(): string | null {
    return this.data.lastDigest;
  }

  async add(feedback: Feedback, now = new Date()): Promise<StoredFeedback> {
    const item: StoredFeedback = {
      id: randomUUID(),
      receivedAt: now.toISOString(),
      kind: feedback.kind,
      message: feedback.message,
      ...(feedback.email ? { email: feedback.email } : {}),
      ...(feedback.name ? { name: feedback.name } : {}),
      ...(feedback.details ? { details: feedback.details } : {}),
      resolvedAt: null,
    };
    this.data.feedback.push(item);
    await this.save();
    return item;
  }

  /** Mark one as dealt with (or open again). False if there is no such item. */
  async setResolved(id: string, resolved: boolean, now = new Date()): Promise<boolean> {
    const index = this.data.feedback.findIndex((item) => item.id === id);
    const item = this.data.feedback[index];
    if (!item) return false;
    this.data.feedback[index] = { ...item, resolvedAt: resolved ? now.toISOString() : null };
    await this.save();
    return true;
  }

  async remove(id: string): Promise<boolean> {
    const before = this.data.feedback.length;
    this.data.feedback = this.data.feedback.filter((item) => item.id !== id);
    if (this.data.feedback.length === before) return false;
    await this.save();
    return true;
  }

  async setLastDigest(date: string): Promise<void> {
    this.data.lastDigest = date;
    await this.save();
  }

  /** Writes happen one after another, each saving whatever is current when it runs. */
  private save(): Promise<void> {
    const run = async (): Promise<void> => {
      const temporary = `${this.file}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(this.data, null, 2), 'utf8');
      await rename(temporary, this.file);
    };
    const next = this.writing.then(run, run);
    this.writing = next.catch(() => undefined);
    return next;
  }
}
