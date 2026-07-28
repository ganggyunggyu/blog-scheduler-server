const KST = 'Asia/Seoul';

export const formatKstTime = (value?: string | number | Date | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: KST,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
};

export const formatKstDateTime = (value?: string | number | Date | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: KST,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
};

export const formatRelative = (value?: string | number | Date | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSeconds);
  const formatter = new Intl.RelativeTimeFormat('ko', { numeric: 'auto' });

  if (abs < 60) return formatter.format(diffSeconds, 'second');
  if (abs < 3600) return formatter.format(Math.round(diffSeconds / 60), 'minute');
  if (abs < 86400) return formatter.format(Math.round(diffSeconds / 3600), 'hour');
  return formatter.format(Math.round(diffSeconds / 86400), 'day');
};

export const maskAccountId = (accountId: string): string => {
  if (!accountId) return '-';
  const [user, domain] = accountId.split('@');
  if (domain && user) return `${user.slice(0, 3)}***@${domain}`;
  return `${accountId.slice(0, 3)}***`;
};
