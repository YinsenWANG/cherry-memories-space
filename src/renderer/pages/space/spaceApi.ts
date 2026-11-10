export class SpaceApi {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string
  ) {}

  async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.message || result.error || `HTTP ${response.status}`)
    return result as T
  }
}
