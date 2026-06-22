// Jest mock for @faker-js/faker package
export const fakerPT_BR = {
  person: {
    fullName: () => 'Test User',
    firstName: () => 'Test',
    lastName: () => 'User',
  },
  internet: {
    email: () => 'test@example.com',
    password: () => 'password123',
    ip: () => '127.0.0.1',
    userAgent: () => 'Mozilla/5.0',
  },
  company: {
    name: () => 'Test Company',
  },
  lorem: {
    sentence: () => 'Lorem ipsum dolor sit amet.',
    paragraphs: () => 'Lorem ipsum dolor sit amet.',
  },
  date: {
    past: () => new Date(),
    future: () => new Date(),
  },
  number: {
    int: (opts?: any) => 1,
    float: (opts?: any) => 1.0,
  },
  datatype: {
    boolean: () => true,
  },
  location: {
    city: () => 'São Paulo',
    state: () => 'SP',
  }
};
