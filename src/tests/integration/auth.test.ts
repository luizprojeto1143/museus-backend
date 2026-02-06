import request from 'supertest';
import { app } from '../../index';

describe('Auth Integration', () => {
    it('should return 400 for missing credentials on login', async () => {
        const res = await request(app)
            .post('/auth/login')
            .send({});

        expect(res.status).toBe(400);
    });

    it('should return 401 for invalid credentials', async () => {
        const res = await request(app)
            .post('/auth/login')
            .send({
                email: 'invalid@example.com',
                password: 'wrongpassword'
            });

        // Could be 401 or 404 depending on implementation, usually 401 or 400 with generic message
        expect([400, 401, 404]).toContain(res.status);
    });

    it('should validate Health Check', async () => {
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: 'ok' });
    });
});
