const request = require('supertest');
const app = require('./server');

describe('Proxy Token Site API Tests', () => {
  it('should return 400 for missing username/phone in /api/register', async () => {
    const res = await request(app)
      .post('/api/register')
      .send({ username: 'testuser' });
    expect(res.statusCode).toEqual(400);
    expect(res.body.success).toBe(false);
  });

  it('should return 400 for missing username/phone in /api/check-status', async () => {
    const res = await request(app)
      .post('/api/check-status')
      .send({});
    expect(res.statusCode).toEqual(400);
    expect(res.body.success).toBe(false);
  });

  it('should return 400 for missing username/phone in /api/generate-token', async () => {
    const res = await request(app)
      .post('/api/generate-token')
      .send({ phone: '1234567890' });
    expect(res.statusCode).toEqual(400);
    expect(res.body.success).toBe(false);
  });

  it('should return 401 for admin endpoints without token', async () => {
    const res = await request(app).get('/api/admin/pending');
    expect(res.statusCode).toEqual(401);
    expect(res.body.success).toBe(false);
  });
});
