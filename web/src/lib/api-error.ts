// A failure the interface can explain: a stable code and a message safe to show.
// Code written with AI assistance (Claude); see AI_USAGE.md.
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
