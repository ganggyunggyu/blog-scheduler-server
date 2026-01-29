import type { BrowserContext, Frame, Page } from 'playwright';

export interface BrowserSession {
  context: BrowserContext;
  page: Page;
}

export interface EditorContext {
  page: Page;
  frame: Frame;
}

export interface PublishOptions {
  category?: string;
  isPublic?: boolean;
  scheduleTime?: string;
}

export interface WriteResult {
  success: boolean;
  postUrl?: string;
  message: string;
}
