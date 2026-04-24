export type AutomationEvent = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type AutomationRule = {
  id: string;
  triggerEvent: string;
  conditions: Record<string, unknown>;
  actions: Array<Record<string, unknown>>;
};
