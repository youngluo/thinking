import transform from '../transform'

const list = [
  { id: 1001, pid: 0, name: 'AA' },
  { id: 1002, pid: 1001, name: 'BB' },
  { id: 1003, pid: 1001, name: 'CC' },
  { id: 1004, pid: 1003, name: 'DD' },
  { id: 1005, pid: 1003, name: 'EE' },
  { id: 1006, pid: 1002, name: 'FF' },
  { id: 1007, pid: 1002, name: 'GG' },
  { id: 1008, pid: 1004, name: 'HH' },
  { id: 1009, pid: 1005, name: 'II' },
]

const tree = [
  {
    id: 1001,
    pid: 0,
    name: 'AA',
    children: [
      {
        id: 1002,
        pid: 1001,
        name: 'BB',
        children: [
          {
            id: 1006,
            pid: 1002,
            name: 'FF',
            children: [],
          },
          {
            id: 1007,
            pid: 1002,
            name: 'GG',
            children: [],
          },
        ],
      },
      {
        id: 1003,
        pid: 1001,
        name: 'CC',
        children: [
          {
            id: 1004,
            pid: 1003,
            name: 'DD',
            children: [
              {
                id: 1008,
                pid: 1004,
                name: 'HH',
                children: [],
              },
            ],
          },
          {
            id: 1005,
            pid: 1003,
            name: 'EE',
            children: [
              {
                id: 1009,
                pid: 1005,
                name: 'II',
                children: [],
              },
            ],
          },
        ],
      },
    ],
  },
]

describe('transform', () => {
  test('should transform list into tree', () => {
    expect(transform(list)).toEqual(tree)
  })
})
