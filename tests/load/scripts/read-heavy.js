import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '1m', target: 50 },
    { duration: '3m', target: 100 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE = __ENV.API_URL || 'http://localhost:4000';
const TOKEN = __ENV.TEST_JWT;

export default function () {
  const h = { Authorization: `Bearer ${TOKEN}` };
  const r1 = http.get(`${BASE}/api/v1/patients`, { headers: h });
  check(r1, { 'patients 200': (r) => r.status === 200 });
  const r2 = http.get(`${BASE}/api/v1/queues`, { headers: h });
  check(r2, { 'queues 200': (r) => r.status === 200 });
  sleep(1);
}
