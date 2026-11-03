// A git remote over HTTP on 127.0.0.1 that wants a token, as gitlab.com does: `git http-backend` behind Basic auth.
// Tests use it to check that the push token reaches git; nothing here talks to a real remote.
import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export type HttpRemote = {
  /** Base URL, such as http://127.0.0.1:53412; repos are `${url}/<name>.git` under `root`. */
  url: string
  /** Authorization headers received, to check the token went over the wire. */
  authorizations: string[]
  close(): Promise<void>
}

/** Serves the bare repos under `root`, accepting only `oauth2:<token>`. */
export async function startHttpRemote(root: string, token: string): Promise<HttpRemote> {
  const authorizations: string[] = []
  const expected = `Basic ${Buffer.from(`oauth2:${token}`).toString('base64')}`
  const server: Server = createServer((req, res) => {
    const authorization = req.headers.authorization
    if (authorization !== undefined) authorizations.push(authorization)
    if (authorization !== expected) {
      res.writeHead(401, { 'www-authenticate': 'Basic realm="test"' }).end()
      return
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    const backend = spawn('git', ['http-backend'], {
      env: {
        PATH: process.env.PATH,
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: url.pathname,
        QUERY_STRING: url.search.slice(1),
        REQUEST_METHOD: req.method,
        CONTENT_TYPE: req.headers['content-type'] ?? '',
        HTTP_CONTENT_ENCODING: req.headers['content-encoding'] ?? '',
        // Set, so http-backend allows pushes.
        REMOTE_USER: 'oauth2',
        REMOTE_ADDR: '127.0.0.1',
      },
    })
    req.pipe(backend.stdin)
    const chunks: Buffer[] = []
    backend.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    backend.on('close', () => {
      const output = Buffer.concat(chunks)
      const end = output.indexOf('\r\n\r\n')
      const headers: Record<string, string> = {}
      let status = 200
      for (const line of output.subarray(0, end).toString().split('\r\n')) {
        const [name, ...value] = line.split(':')
        if (name!.toLowerCase() === 'status') status = Number.parseInt(value.join(':').trim(), 10)
        else headers[name!] = value.join(':').trim()
      }
      res.writeHead(status, headers).end(output.subarray(end + 4))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    authorizations,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
