package services

import (
	"math"
	"math/rand"
	"sort"
)

const (
	peopleANNConnections    = 16
	peopleANNEfConstruction = 100
	peopleANNEfSearch       = 128
	peopleANNCandidateLimit = 128
)

type peopleANNHit struct {
	id    string
	score float32
}

type peopleANNNode struct {
	id        string
	vector    []float32
	level     int
	neighbors [][]int
}

type peopleANNCandidate struct {
	index int
	score float32
}

type peopleANNQueue struct {
	items []peopleANNCandidate
	max   bool
}

func (q *peopleANNQueue) Len() int { return len(q.items) }

func (q *peopleANNQueue) precedes(left, right peopleANNCandidate) bool {
	if q.max {
		return peopleANNBetter(left, right)
	}
	return peopleANNBetter(right, left)
}

func (q *peopleANNQueue) push(candidate peopleANNCandidate) {
	q.items = append(q.items, candidate)
	index := len(q.items) - 1
	for index > 0 {
		parent := (index - 1) / 2
		if !q.precedes(q.items[index], q.items[parent]) {
			break
		}
		q.items[index], q.items[parent] = q.items[parent], q.items[index]
		index = parent
	}
}

func (q *peopleANNQueue) pop() peopleANNCandidate {
	value := q.items[0]
	last := len(q.items) - 1
	lastValue := q.items[last]
	q.items = q.items[:last]
	if last == 0 {
		return value
	}
	q.items[0] = lastValue
	for index := 0; ; {
		left := index*2 + 1
		if left >= len(q.items) {
			break
		}
		best := left
		right := left + 1
		if right < len(q.items) && q.precedes(q.items[right], q.items[left]) {
			best = right
		}
		if !q.precedes(q.items[best], q.items[index]) {
			break
		}
		q.items[index], q.items[best] = q.items[best], q.items[index]
		index = best
	}
	return value
}

type peopleANNIndex struct {
	nodes          []peopleANNNode
	nodeByID       map[string]int
	dimension      int
	entry          int
	maxLevel       int
	rng            *rand.Rand
	connections    int
	efConstruction int
	efSearch       int
}

func newPeopleANNIndex() *peopleANNIndex {
	return newPeopleANNIndexForDimension(peopleEmbeddingDimension)
}

func newPeopleANNIndexForDimension(dimension int) *peopleANNIndex {
	return &peopleANNIndex{
		nodeByID:       make(map[string]int),
		dimension:      dimension,
		entry:          -1,
		maxLevel:       -1,
		rng:            rand.New(rand.NewSource(42)),
		connections:    peopleANNConnections,
		efConstruction: peopleANNEfConstruction,
		efSearch:       peopleANNEfSearch,
	}
}

func (index *peopleANNIndex) Len() int {
	return len(index.nodes)
}

func (index *peopleANNIndex) Add(id string, vector []float32) {
	if len(vector) != index.dimension {
		return
	}
	if existing, exists := index.nodeByID[id]; exists {
		index.nodes[existing].vector = vector
		return
	}

	level := index.randomLevel()
	nodeIndex := len(index.nodes)
	index.nodes = append(index.nodes, peopleANNNode{
		id: id, vector: vector, level: level, neighbors: make([][]int, level+1),
	})
	index.nodeByID[id] = nodeIndex
	if index.entry == -1 {
		index.entry = nodeIndex
		index.maxLevel = level
		return
	}

	entry := index.entry
	for layer := index.maxLevel; layer > level; layer-- {
		entry = index.greedyClosest(vector, entry, layer)
	}
	for layer := min(level, index.maxLevel); layer >= 0; layer-- {
		candidates := index.searchLayer(vector, entry, index.efConstruction, layer)
		neighbors := index.selectNeighbors(vector, candidates, index.maxNeighbors(layer))
		index.nodes[nodeIndex].neighbors[layer] = neighbors
		for _, neighborIndex := range neighbors {
			neighbor := &index.nodes[neighborIndex]
			neighbor.neighbors[layer] = append(neighbor.neighbors[layer], nodeIndex)
			if len(neighbor.neighbors[layer]) > index.maxNeighbors(layer) {
				neighbor.neighbors[layer] = index.pruneNeighbors(neighborIndex, layer)
			}
		}
		if len(candidates) > 0 {
			entry = candidates[0].index
		}
	}
	if level > index.maxLevel {
		index.entry = nodeIndex
		index.maxLevel = level
	}
}

func (index *peopleANNIndex) Search(query []float32, limit int) []peopleANNHit {
	return index.SearchWithEf(query, limit, index.efSearch)
}

// SearchWithEf 允许调用方按需要收紧搜索宽度。
// 复核页面要为每个分组各做一次近邻查找，宽度直接决定整体耗时，
// 因此这里允许在召回与速度之间取舍。
func (index *peopleANNIndex) SearchWithEf(query []float32, limit, ef int) []peopleANNHit {
	if index.entry < 0 || limit <= 0 || len(query) != index.dimension {
		return nil
	}
	if len(index.nodes) <= limit {
		hits := make([]peopleANNHit, len(index.nodes))
		for i, node := range index.nodes {
			hits[i] = peopleANNHit{id: node.id, score: peopleANNDot(query, node.vector)}
		}
		sort.Slice(hits, func(i, j int) bool {
			if hits[i].score != hits[j].score {
				return hits[i].score > hits[j].score
			}
			return hits[i].id < hits[j].id
		})
		return hits
	}
	if ef < limit {
		ef = limit
	}
	entry := index.entry
	for layer := index.maxLevel; layer > 0; layer-- {
		entry = index.greedyClosest(query, entry, layer)
	}
	candidates := index.searchLayer(query, entry, max(ef, limit), 0)
	if len(candidates) > limit {
		candidates = candidates[:limit]
	}
	hits := make([]peopleANNHit, len(candidates))
	for i, candidate := range candidates {
		hits[i] = peopleANNHit{id: index.nodes[candidate.index].id, score: candidate.score}
	}
	return hits
}

func (index *peopleANNIndex) randomLevel() int {
	value := index.rng.Float64()
	if value == 0 {
		value = 1e-12
	}
	return int(math.Floor(-math.Log(value) / math.Log(float64(index.connections))))
}

func (index *peopleANNIndex) maxNeighbors(layer int) int {
	if layer == 0 {
		return 2 * index.connections
	}
	return index.connections
}

func (index *peopleANNIndex) greedyClosest(query []float32, entry, layer int) int {
	best := peopleANNCandidate{index: entry, score: peopleANNDot(query, index.nodes[entry].vector)}
	for {
		changed := false
		for _, neighbor := range index.nodes[best.index].neighbors[layer] {
			candidate := peopleANNCandidate{index: neighbor, score: peopleANNDot(query, index.nodes[neighbor].vector)}
			if peopleANNBetter(candidate, best) {
				best = candidate
				changed = true
			}
		}
		if !changed {
			return best.index
		}
	}
}

func (index *peopleANNIndex) searchLayer(query []float32, entry, limit, layer int) []peopleANNCandidate {
	if limit < 1 {
		limit = 1
	}
	first := peopleANNCandidate{index: entry, score: peopleANNDot(query, index.nodes[entry].vector)}
	capacity := min(limit*4, len(index.nodes))
	candidates := &peopleANNQueue{items: make([]peopleANNCandidate, 0, capacity), max: true}
	results := &peopleANNQueue{items: make([]peopleANNCandidate, 0, min(limit, len(index.nodes)))}
	candidates.push(first)
	results.push(first)
	visited := make(map[int]struct{}, capacity)
	visited[entry] = struct{}{}
	for candidates.Len() > 0 {
		current := candidates.pop()
		worst := results.items[0]
		if results.Len() >= limit && !peopleANNBetter(current, worst) {
			break
		}
		for _, neighbor := range index.nodes[current.index].neighbors[layer] {
			if _, exists := visited[neighbor]; exists {
				continue
			}
			visited[neighbor] = struct{}{}
			candidate := peopleANNCandidate{index: neighbor, score: peopleANNDot(query, index.nodes[neighbor].vector)}
			if results.Len() < limit || peopleANNBetter(candidate, results.items[0]) {
				candidates.push(candidate)
				results.push(candidate)
				if results.Len() > limit {
					results.pop()
				}
			}
		}
	}
	sort.Slice(results.items, func(i, j int) bool {
		return peopleANNBetter(results.items[i], results.items[j])
	})
	return results.items
}

func (index *peopleANNIndex) selectNeighbors(query []float32, candidates []peopleANNCandidate, limit int) []int {
	selected := make([]int, 0, min(limit, len(candidates)))
	pruned := make([]int, 0, len(candidates))
	for _, candidate := range candidates {
		if len(selected) >= limit {
			break
		}
		dominated := false
		for _, selectedIndex := range selected {
			if peopleANNDot(index.nodes[candidate.index].vector, index.nodes[selectedIndex].vector) > candidate.score {
				dominated = true
				break
			}
		}
		if dominated {
			pruned = append(pruned, candidate.index)
		} else {
			selected = append(selected, candidate.index)
		}
	}
	for _, candidateIndex := range pruned {
		if len(selected) >= limit {
			break
		}
		selected = append(selected, candidateIndex)
	}
	return selected
}

func (index *peopleANNIndex) pruneNeighbors(nodeIndex, layer int) []int {
	query := index.nodes[nodeIndex].vector
	neighbors := index.nodes[nodeIndex].neighbors[layer]
	candidates := make([]peopleANNCandidate, len(neighbors))
	for i, neighbor := range neighbors {
		candidates[i] = peopleANNCandidate{index: neighbor, score: peopleANNDot(query, index.nodes[neighbor].vector)}
	}
	sort.Slice(candidates, func(i, j int) bool {
		return peopleANNBetter(candidates[i], candidates[j])
	})
	return index.selectNeighbors(query, candidates, index.maxNeighbors(layer))
}

func peopleANNBetter(left, right peopleANNCandidate) bool {
	if left.score != right.score {
		return left.score > right.score
	}
	return left.index < right.index
}

func peopleANNDot(left, right []float32) float32 {
	var score float32
	for i, value := range left {
		score += value * right[i]
	}
	return score
}
