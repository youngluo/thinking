interface Item {
  children?: Item[]
  name: string
  pid: number
  id: number
}

export default function transform(list: Item[]) {
  const map = new Map()
  const tree = []
  for (let i = 0; i < list.length; i++) {
    const node = list[i]
    node.children = []
    map.set(node.id, node)
  }

  for (let i = 0; i < list.length; i++) {
    const node = list[i]
    if (map.has(node.pid)) {
      map.get(node.pid).children.push(node)
    } else {
      tree.push(node)
    }
  }

  return tree
}
