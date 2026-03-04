// Unified context reference type for anything that can be attached to a chat message.
// Discriminated on `source` so TypeScript can narrow the type in switch/if branches.

interface BaseReference {
  id: string;
  name: string;
  addedAt: number;
}

export interface NasReference extends BaseReference {
  source: 'nas';
  path: string;
  type: 'file' | 'directory';
  size?: number;
  ext?: string;
  mimeType?: string;
}

export interface EmailReference extends BaseReference {
  source: 'email';
  uid: number;
  mailbox: string;
  accountId?: string;
  subject: string;
  from: string;
  date: string;
  hasAttachments: boolean;
}

export type ContextReference = NasReference | EmailReference;
