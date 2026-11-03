// Test stand-ins for expo-notifications, expo-device and expo-constants
// (not a test file). Use from a test with:
//   jest.mock("expo-notifications", () => jest.requireActual("<path>/__fixtures__/native-mocks").notificationsModule);
// and drive the phone through `mockPhone`.

type Listener<T> = (event: T) => void;

export type FakeResponse = {
  actionIdentifier: string;
  notification: { request: { identifier: string; content: { data: unknown } } };
};

export const DEFAULT_ACTION = "expo.modules.notifications.actions.DEFAULT";

function permission(status: "granted" | "denied" | "undetermined") {
  return { status, granted: status === "granted", canAskAgain: status !== "denied", expires: "never" };
}

export const mockPhone = {
  projectId: "11111111-2222-3333-4444-555555555555" as string | null,
  isDevice: true,
  version: "1.0.0",
  permission: "undetermined" as "granted" | "denied" | "undetermined",
  /** What the system prompt answers. */
  answer: "granted" as "granted" | "denied",
  token: "ExponentPushToken[phone-one-0001]",
  tokenFails: false,
  /** Leave the permission check unanswered (to see the loading state). */
  permissionHangs: false,
  lastResponse: null as FakeResponse | null,
  responseListeners: new Set<Listener<FakeResponse>>(),
  tokenListeners: new Set<Listener<unknown>>(),
  badge: [] as number[],
  channels: [] as string[],
  asked: 0,
  reset() {
    this.projectId = "11111111-2222-3333-4444-555555555555";
    this.isDevice = true;
    this.version = "1.0.0";
    this.permission = "undetermined";
    this.answer = "granted";
    this.token = "ExponentPushToken[phone-one-0001]";
    this.tokenFails = false;
    this.permissionHangs = false;
    this.lastResponse = null;
    this.responseListeners.clear();
    this.tokenListeners.clear();
    this.badge = [];
    this.channels = [];
    this.asked = 0;
  },
  tap(data: unknown, id = `n-${Math.random()}`) {
    const response: FakeResponse = {
      actionIdentifier: DEFAULT_ACTION,
      notification: { request: { identifier: id, content: { data } } },
    };
    this.responseListeners.forEach((l) => l(response));
  },
  coldStart(data: unknown, id = "cold-1") {
    this.lastResponse = {
      actionIdentifier: DEFAULT_ACTION,
      notification: { request: { identifier: id, content: { data } } },
    };
  },
};

function subscribe<T>(set: Set<Listener<T>>, fn: Listener<T>) {
  set.add(fn);
  return { remove: () => set.delete(fn) };
}

export const notificationsModule = {
  DEFAULT_ACTION_IDENTIFIER: DEFAULT_ACTION,
  AndroidImportance: { DEFAULT: 3 },
  IosAuthorizationStatus: { NOT_DETERMINED: 0, DENIED: 1, AUTHORIZED: 2, PROVISIONAL: 3, EPHEMERAL: 4 },
  getPermissionsAsync: () =>
    mockPhone.permissionHangs ? new Promise(() => {}) : Promise.resolve(permission(mockPhone.permission)),
  requestPermissionsAsync: async () => {
    mockPhone.asked += 1;
    if (mockPhone.permission === "undetermined") mockPhone.permission = mockPhone.answer;
    return permission(mockPhone.permission);
  },
  getExpoPushTokenAsync: async ({ projectId }: { projectId: string }) => {
    if (mockPhone.tokenFails || !projectId) throw new Error("no token");
    return { type: "expo", data: mockPhone.token };
  },
  setNotificationHandler: () => {},
  setNotificationChannelAsync: async (id: string) => {
    mockPhone.channels.push(id);
    return null;
  },
  setBadgeCountAsync: async (n: number) => {
    mockPhone.badge.push(n);
    return true;
  },
  addPushTokenListener: (fn: Listener<unknown>) => subscribe(mockPhone.tokenListeners, fn),
  addNotificationResponseReceivedListener: (fn: Listener<FakeResponse>) => subscribe(mockPhone.responseListeners, fn),
  getLastNotificationResponse: () => mockPhone.lastResponse,
  clearLastNotificationResponse: () => {
    mockPhone.lastResponse = null;
  },
};

export const deviceModule = {
  get isDevice() {
    return mockPhone.isDevice;
  },
  modelName: "iPhone 15",
};

export const constantsModule = {
  __esModule: true,
  default: {
    get expoConfig() {
      return {
        version: mockPhone.version,
        extra: mockPhone.projectId ? { eas: { projectId: mockPhone.projectId } } : {},
      };
    },
    easConfig: null,
  },
};
