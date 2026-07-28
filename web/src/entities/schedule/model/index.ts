export type ScheduleMode = '1' | '2' | '3' | '2121';

export type ImageSource = 'ai' | 'google' | 'keyword' | 'product' | 'local';

export type ManuscriptType =
  | 'default'
  | 'restaurant/v1'
  | 'restaurant/v2'
  | 'pet'
  | 'grok'
  | 'keigo'
  | 'hanryeodamwon'
  | 'nyangnyang'
  | 'kimdongpal'
  | 'alibaba';

export interface Schedule {
  _id: string;
  accountId: string;
  status: 'pending' | 'running' | 'completed' | 'cancelled' | 'failed' | string;
  service?: string;
  mode?: string;
  keywords?: string[];
  createdAt?: string;
  updatedAt?: string;
  startDate?: string;
}

export interface ScheduleJob {
  _id: string;
  scheduleId: string;
  day: number;
  slot: number;
  keyword?: string;
  status: string;
  scheduledAt?: string;
  error?: string;
  generateJobId?: string;
  publishJobId?: string;
}

export interface ScheduleItemOption {
  businessName?: string;
  manuscriptType?: ManuscriptType;
}

export interface AutoScheduleQueue {
  account: { id: string; password: string; blogId?: string };
  keywords: string[];
  item_options?: ScheduleItemOption[];
  blog_name?: string;
}

export interface AutoSchedulePayload {
  queues: AutoScheduleQueue[];
  schedule_date?: string;
  schedule_mode: ScheduleMode;
  service: string;
  generate_images: boolean;
  image_count: number;
  image_source: ImageSource;
  manuscript_type: ManuscriptType;
  delay_between_posts: number;
  keyword_category?: string;
}

export interface DomainPreset {
  id: string;
  label: string;
  service: string;
  imageSource: ImageSource;
  manuscriptType: ManuscriptType;
  keywordCategory: string;
  scheduleMode: ScheduleMode;
  /** 맛집처럼 항목마다 업체명을 지정해야 하는 도메인 */
  requiresBusinessName: boolean;
  /** 맛집1/맛집2 처럼 원고 타입을 번갈아 쓰는 도메인 */
  alternatingTypes?: [ManuscriptType, ManuscriptType];
  note: string;
}
