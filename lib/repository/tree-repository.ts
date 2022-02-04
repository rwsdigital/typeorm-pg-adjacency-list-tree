import { keyBy, map } from 'lodash'
import { In, Repository } from 'typeorm'
import { FindTreeOptions } from 'typeorm/find-options/FindTreeOptions'
import { childrenPropertyMetadataArgs } from '../constant/decorator-constants'
import { ITreeRepository } from './tree-repository.interface'

export interface IBaseTreeEntity {
  id: number
  parentId: number
}

export class TreeRepository<Entity> extends Repository<Entity> implements ITreeRepository<Entity> {
  public async findTrees(options?: FindTreeOptions) {
    const roots = await this.findRoots(options)
    const trees = await Promise.all(roots.map((root) => this.findDescendantsTree(root, options)))
    return trees
  }

  public findRoots(options?: FindTreeOptions) {
    return this.find({ where: { parentId: null }, relations: options?.relations })
  }

  public async findDescendants(root: Entity, options?: FindTreeOptions) {
    const rootAsTreeEntity = root as unknown as IBaseTreeEntity
    const rawNodes = await this.manager.query(`
      WITH RECURSIVE r AS (
        SELECT id, 0 as depth
        FROM ${this.metadata.tablePath}
        WHERE id = ${rootAsTreeEntity.id}

        UNION

        SELECT ${this.metadata.tablePath}.id, r.depth + 1
        FROM ${this.metadata.tablePath}
          JOIN r
              ON ${this.metadata.tablePath}.${this._parentColumnName} = r.id

        ${options?.depth ? `WHERE depth < ${options.depth - 1}` : ``}
      )

      SELECT * FROM r;
    `)

    const nodeIds = map(rawNodes, 'id')
    const nodes = await this.find({ where: { id: In(nodeIds) }, relations: options?.relations })

    return nodes
  }

  public async findDescendantsTree(root: Entity, options?: FindTreeOptions) {
    const nodes = await this.findDescendants(root, options)
    const rootAsTreeEntity = root as unknown as IBaseTreeEntity
    const assembledTreeNodes = this._assembleOrgTreeNodes(nodes, rootAsTreeEntity.id)

    return assembledTreeNodes
  }

  private _assembleOrgTreeNodes(nodes: Entity[], rootId: number) {
    const idToNode = keyBy(nodes, 'id')

    for (const node of nodes) {
      const nodeAsAny = node as any
      const parentIdAsAny = nodeAsAny.parentId as any

      if (parentIdAsAny) {
        const parentAsAny = idToNode[parentIdAsAny] as any

        if (!parentAsAny[this._childrenPropertyName]) {
          parentAsAny[this._childrenPropertyName] = []
        }

        parentAsAny[this._childrenPropertyName].push(node)
      }
    }

    return idToNode[rootId]
  }

  private get _entity() {
    return this.target
  }

  private get _parentColumnName() {
    return 'parent_id'
  }

  private get _childrenPropertyName() {
    const [, childrenPropertyName] = Reflect.getMetadata(childrenPropertyMetadataArgs, this._entity)
    return childrenPropertyName
  }
}
