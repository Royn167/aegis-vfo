import { Router } from 'express'
import { body, query as queryValidator, validationResult } from 'express-validator'
import { query } from '../utils/database.js'
import { requireRole } from '../middleware/auth.js'
import { logger } from '../utils/logger.js'

const router = Router()

// Get relationship graph
router.get('/graph', [
  queryValidator('entity_type').optional().isIn(['principal', 'asset', 'entity']),
  queryValidator('entity_id').optional().isUUID(),
  queryValidator('depth').optional().isInt({ min: 1, max: 5 })
], async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() })
    }

    const { entity_type, entity_id, depth = 2 } = req.query

    if (!entity_id || !entity_type) {
      return res.status(400).json({ error: 'entity_id and entity_type are required' })
    }

    // Get relationships within specified depth
    const relationshipResult = await query(`
      WITH RECURSIVE relationship_graph AS (
        -- Base case: direct relationships
        SELECT 
          r.id, r.from_entity_type, r.from_entity_id, r.to_entity_type, r.to_entity_id,
          r.relationship_type, r.percentage, r.metadata,
          1 as depth, ARRAY[r.from_entity_id] as path
        FROM relationships r
        WHERE (r.from_entity_type = $1 AND r.from_entity_id = $2)
           OR (r.to_entity_type = $1 AND r.to_entity_id = $2)
        AND r.is_active = true
        
        UNION ALL
        
        -- Recursive case: extend relationships
        SELECT 
          r.id, r.from_entity_type, r.from_entity_id, r.to_entity_type, r.to_entity_id,
          r.relationship_type, r.percentage, r.metadata,
          rg.depth + 1, rg.path || r.from_entity_id
        FROM relationships r
        JOIN relationship_graph rg ON 
          (r.from_entity_type = rg.to_entity_type AND r.from_entity_id = rg.to_entity_id)
          OR (r.to_entity_type = rg.from_entity_type AND r.to_entity_id = rg.from_entity_id)
        WHERE rg.depth < $3
          AND r.is_active = true
          AND NOT (r.to_entity_id = ANY(rg.path)) -- Prevent cycles
      )
      SELECT DISTINCT * FROM relationship_graph
      ORDER BY depth, relationship_type
    `, [entity_type, entity_id, depth])

    // Get entity details for all nodes in the graph
    const entityIds = new Set()
    const entityTypes = new Map()
    
    relationshipResult.rows.forEach(row => {
      entityIds.add(row.from_entity_id)
      entityIds.add(row.to_entity_id)
      entityTypes.set(row.from_entity_id, row.from_entity_type)
      entityTypes.set(row.to_entity_id, row.to_entity_type)
    })

    // Fetch entity details
    const nodes = []
    for (const [entityId, entityType] of entityTypes) {
      let tableName = entityType === 'principal' ? 'principals' : 
                     entityType === 'asset' ? 'assets' : 'entities'
      
      const entityResult = await query(`
        SELECT id, reference_number, 
               CASE 
                 WHEN $2 = 'principal' THEN first_name || ' ' || last_name
                 ELSE name 
               END as name,
               $2 as entity_type
        FROM ${tableName}
        WHERE id = $1
      `, [entityId, entityType])
      
      if (entityResult.rows.length > 0) {
        nodes.push(entityResult.rows[0])
      }
    }

    res.json({
      nodes,
      edges: relationshipResult.rows,
      metadata: {
        total_nodes: nodes.length,
        total_edges: relationshipResult.rows.length,
        max_depth: depth
      }
    })
  } catch (error) {
    logger.error('Error getting relationship graph:', error)
    res.status(500).json({ error: 'Failed to get relationship graph' })
  }
})

// Create relationship
router.post('/', [
  requireRole(['admin', 'advisor']),
  body('from_entity_type').isIn(['principal', 'asset', 'entity']),
  body('from_entity_id').isUUID(),
  body('to_entity_type').isIn(['principal', 'asset', 'entity']),
  body('to_entity_id').isUUID(),
  body('relationship_type').notEmpty(),
  body('percentage').optional().isFloat({ min: 0, max: 100 })
], async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() })
    }

    const result = await query(`
      INSERT INTO relationships (from_entity_type, from_entity_id, to_entity_type, to_entity_id,
                               relationship_type, percentage, start_date, metadata, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      req.body.from_entity_type,
      req.body.from_entity_id,
      req.body.to_entity_type,
      req.body.to_entity_id,
      req.body.relationship_type,
      req.body.percentage || null,
      req.body.start_date || null,
      JSON.stringify(req.body.metadata || {}),
      req.user.id
    ])

    logger.info('Relationship created', { 
      relationshipId: result.rows[0].id,
      createdBy: req.user.id 
    })

    res.status(201).json(result.rows[0])
  } catch (error) {
    logger.error('Error creating relationship:', error)
    if (error.code === '23505') {
      res.status(409).json({ error: 'Relationship already exists' })
    } else {
      res.status(500).json({ error: 'Failed to create relationship' })
    }
  }
})

export default router