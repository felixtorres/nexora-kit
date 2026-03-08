export default {
  name: 'lookup_ticket',
  description: 'Look up a ticket by ID',
  namespace: 'my-team',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Ticket ID' },
    },
    required: ['id'],
  },
  async handler(input) {
    return `Ticket ${input.id}: Open`;
  },
};
