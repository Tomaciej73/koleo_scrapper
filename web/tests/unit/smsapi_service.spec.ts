import SmsApiService, { SmsApiError } from '#services/smsapi_service'
import { test } from '@japa/runner'

const configuration = {
  url: 'https://smsapi.example.test/sms.do',
  sender: 'KOLEOWATCH',
  timeoutMs: 1_000,
}

test.group('SMSAPI delivery', () => {
  test('sends a form POST with a bearer token and stable duplicate protection', async ({
    assert,
  }) => {
    const requests: RequestInit[] = []
    const request: typeof fetch = async (_input, init) => {
      requests.push(init ?? {})
      return Response.json({ count: 1, list: [{ id: 'message-1', error: null }] })
    }
    const service = new SmsApiService({ ...configuration, token: 'private-test-token' }, request)

    await service.send('+48500600700', 'Cena spadla do 55 zl', 'delivery-1')
    await service.send('+48500600700', 'Cena spadla do 55 zl', 'delivery-1')

    assert.lengthOf(requests, 2)
    const first = requests[0]
    const body = new URLSearchParams(String(first.body))
    assert.equal(first.method, 'POST')
    assert.equal(new Headers(first.headers).get('authorization'), 'Bearer private-test-token')
    assert.equal(body.get('to'), '48500600700')
    assert.equal(body.get('from'), 'KOLEOWATCH')
    assert.equal(body.get('message'), 'Cena spadla do 55 zl')
    assert.equal(body.get('format'), 'json')
    assert.equal(body.get('encoding'), 'utf-8')
    assert.equal(body.get('check_idx'), '1')
    assert.match(body.get('idx')!, /^[a-f\d]{64}$/)
    assert.equal(body.get('idx'), new URLSearchParams(String(requests[1].body)).get('idx'))
    assert.isNull(body.get('password'))
  })

  test('accepts an already-sent result, but rejects other provider errors', async ({ assert }) => {
    const duplicate = new SmsApiService(
      { ...configuration, token: 'private-test-token' },
      async () => Response.json({ error: 53 }, { status: 400 })
    )
    await duplicate.send('+48500600700', 'Test', 'delivery-2')

    const rejected = new SmsApiService(
      { ...configuration, token: 'private-test-token' },
      async () => Response.json({ error: 101, message: 'secret provider detail' })
    )
    await assert.rejects(
      () => rejected.send('+48500600700', 'Test', 'delivery-3'),
      /SMSAPI odrzuciło wiadomość \(kod 101\)/
    )
  })

  test('preserves the SMSAPI error code without exposing provider details', async ({ assert }) => {
    const rejected = new SmsApiService(
      { ...configuration, token: 'private-test-token' },
      async () => Response.json({ error: 14, message: 'private provider detail' }, { status: 400 })
    )

    try {
      await rejected.send('+48500600700', 'Test', 'delivery-sender-error')
      assert.fail('SMSAPI should reject an invalid sender')
    } catch (error) {
      assert.instanceOf(error, SmsApiError)
      assert.equal((error as SmsApiError).code, 14)
      assert.notInclude((error as Error).message, 'private provider detail')
    }
  })

  test('supports the legacy API password only in the POST body', async ({ assert }) => {
    let url = ''
    let requestOptions: RequestInit = {}
    const service = new SmsApiService(
      { ...configuration, username: 'api-client', passwordMd5: 'a'.repeat(32) },
      async (input, init) => {
        url = String(input)
        requestOptions = init ?? {}
        return Response.json({ count: 1, list: [{ id: 'message-2', error: null }] })
      }
    )

    await service.send('+48500600700', 'Test', 'delivery-4')

    const body = new URLSearchParams(String(requestOptions.body))
    assert.equal(url, configuration.url)
    assert.equal(body.get('username'), 'api-client')
    assert.equal(body.get('password'), 'a'.repeat(32))
    assert.isNull(new Headers(requestOptions.headers).get('authorization'))
    assert.notInclude(url, 'api-client')
  })

  test('accepts the broker-style raw API password and hashes it before HTTP Basic auth', async ({
    assert,
  }) => {
    let url = ''
    let requestOptions: RequestInit = {}
    const service = new SmsApiService(
      { ...configuration, username: 'api-client', password: 'secret' },
      async (input, init) => {
        url = String(input)
        requestOptions = init ?? {}
        return Response.json({ count: 1, list: [{ id: 'message-3', error: null }] })
      }
    )

    await service.send('+48500600700', 'Test', 'delivery-5')

    const auth = new Headers(requestOptions.headers).get('authorization')!
    assert.match(auth, /^Basic /)
    assert.equal(
      Buffer.from(auth.slice('Basic '.length), 'base64').toString(),
      'api-client:5ebe2294ecd0e0f08eab7690d2a6ee69'
    )
    assert.equal(url, configuration.url)
    assert.notInclude(String(requestOptions.body), 'secret')
    assert.notInclude(url, 'secret')
  })

  test('prefers the API token when raw API credentials are also configured', async ({ assert }) => {
    let requestOptions: RequestInit = {}
    const service = new SmsApiService(
      { ...configuration, token: 'token', username: 'api-client', password: 'secret' },
      async (_input, init) => {
        requestOptions = init ?? {}
        return Response.json({ count: 1, list: [{ id: 'message-4', error: null }] })
      }
    )

    await service.send('+48500600700', 'Test', 'delivery-6')

    assert.equal(new Headers(requestOptions.headers).get('authorization'), 'Bearer token')
    assert.isNull(new URLSearchParams(String(requestOptions.body)).get('password'))
  })
})
