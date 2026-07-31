export interface BlogAccount {
  id: string;
  name: string;
  loginId: string;
  blogId: string;
  category: string;
  group: string;
  memo: string;
  order: number;
  isActive: boolean;
  /** dabut 에 비밀번호가 저장되어 있는지. 없으면 발행이 안 된다. */
  hasPassword: boolean;
}
