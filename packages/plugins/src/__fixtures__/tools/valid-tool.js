export default {
  name: 'greet_user',
  description: 'Greet a user by name',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'User name' },
    },
    required: ['name'],
  },
  async handler(input) {
    return `Hello, ${input.name}!`;
  },
};
