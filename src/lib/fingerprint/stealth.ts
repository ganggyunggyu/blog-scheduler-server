import type { BrowserContext } from 'playwright';
import type { DeviceProfile } from './profiles.js';

interface ChromeLikeWindow extends Window {
  chrome?: {
    csi: () => Record<string, never>;
    loadTimes: () => Record<string, never>;
    runtime: Record<string, never>;
  };
}

export const applyStealth = async (
  context: BrowserContext,
  profile: DeviceProfile,
): Promise<void> => {
  await context.addInitScript((p) => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

    Object.defineProperty(navigator, 'platform', { get: () => p.platform });
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => p.hardwareConcurrency,
    });
    Object.defineProperty(navigator, 'languages', {
      get: () => [p.locale, p.locale.split('-')[0]],
    });

    const chromeWindow = window as ChromeLikeWindow;
    if (!chromeWindow.chrome) {
      chromeWindow.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
    }

    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'PDF Viewer', filename: 'internal-pdf-viewer' },
        { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer' },
        { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer' },
      ],
    });

    const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
    window.navigator.permissions.query = (params: PermissionDescriptor) =>
      params.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission, onchange: null } as PermissionStatus)
        : originalQuery(params);

    const getParameter = WebGLRenderingContext.prototype.getParameter;
    const webglOverrides = {
      getParameter(this: WebGLRenderingContext, parameter: number) {
        if (parameter === 37445) return 'Intel Inc.';
        if (parameter === 37446) return 'Intel Iris OpenGL Engine';
        return getParameter.call(this, parameter);
      },
    };
    WebGLRenderingContext.prototype.getParameter = webglOverrides.getParameter;
  }, profile);
};
