package services

import (
	"math"
	"math/rand"
	"slices"
	"strings"
)

const (
	peopleANNConnections    = 16
	peopleANNEfConstruction = 100
	peopleANNEfSearch       = 128
	peopleANNCandidateLimit = 128
	// peopleANNStaleNodeLimit 是索引里允许留下的旧节点上限。
	// 分组没了以后索引里的节点没法立刻删（邻接表指着它），
	// 查近邻时按分组 ID 回查、查不到就跳过。攒多了再整体重建索引。
	peopleANNStaleNodeLimit = 256
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

	// 下面是搜索与剪枝的暂存区。
	//
	// 一次搜索要访问上千个节点，原先每次都新建一张 visited 表和两个队列：
	// 一万两千个节点的索引光这些暂存就分配两 GB 多。暂存区只在一次搜索里
	// 活着，复用它们不影响结果，只省掉绝大部分分配与 GC 压力。
	visited      []uint32
	visitedEpoch uint32
	searchQueue  peopleANNQueue
	resultQueue  peopleANNQueue
	pruneBuffer  []peopleANNCandidate
	prunedBuffer []int
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
		slices.SortFunc(hits, func(left, right peopleANNHit) int {
			if left.score != right.score {
				if left.score > right.score {
					return -1
				}
				return 1
			}
			return strings.Compare(left.id, right.id)
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

// searchLayer 在一层图里找最近的若干候选。
//
// 返回的是拷贝：内部的队列是暂存区，下次搜索还要接着用。
func (index *peopleANNIndex) searchLayer(query []float32, entry, limit, layer int) []peopleANNCandidate {
	if limit < 1 {
		limit = 1
	}
	first := peopleANNCandidate{index: entry, score: peopleANNDot(query, index.nodes[entry].vector)}
	candidates := &index.searchQueue
	results := &index.resultQueue
	candidates.items = candidates.items[:0]
	results.items = results.items[:0]
	candidates.max = true
	results.max = false
	index.nextVisitedEpoch()
	index.markVisited(entry)
	candidates.push(first)
	results.push(first)
	for candidates.Len() > 0 {
		current := candidates.pop()
		worst := results.items[0]
		if results.Len() >= limit && !peopleANNBetter(current, worst) {
			break
		}
		for _, neighbor := range index.nodes[current.index].neighbors[layer] {
			if !index.markVisited(neighbor) {
				continue
			}
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
	slices.SortFunc(results.items, peopleANNCompare)
	result := make([]peopleANNCandidate, len(results.items))
	copy(result, results.items)
	return result
}

// nextVisitedEpoch 开始一轮新的访问标记。
func (index *peopleANNIndex) nextVisitedEpoch() {
	index.visitedEpoch++
	if index.visitedEpoch == 0 {
		// 计数器绕回来了，清一遍重新计数。
		clear(index.visited)
		index.visitedEpoch = 1
	}
}

// markVisited 标记节点并报告它是不是第一次被访问。
func (index *peopleANNIndex) markVisited(node int) bool {
	if node >= len(index.visited) {
		index.visited = append(index.visited, make([]uint32, node-len(index.visited)+1)...)
	}
	if index.visited[node] == index.visitedEpoch {
		return false
	}
	index.visited[node] = index.visitedEpoch
	return true
}

func (index *peopleANNIndex) selectNeighbors(query []float32, candidates []peopleANNCandidate, limit int) []int {
	selected := make([]int, 0, min(limit, len(candidates)))
	pruned := index.prunedBuffer[:0]
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
	index.prunedBuffer = pruned[:0]
	return selected
}

func (index *peopleANNIndex) pruneNeighbors(nodeIndex, layer int) []int {
	query := index.nodes[nodeIndex].vector
	neighbors := index.nodes[nodeIndex].neighbors[layer]
	candidates := index.pruneBuffer[:0]
	for _, neighbor := range neighbors {
		candidates = append(candidates, peopleANNCandidate{index: neighbor, score: peopleANNDot(query, index.nodes[neighbor].vector)})
	}
	index.pruneBuffer = candidates
	slices.SortFunc(candidates, peopleANNCompare)
	return index.selectNeighbors(query, candidates, index.maxNeighbors(layer))
}

func peopleANNBetter(left, right peopleANNCandidate) bool {
	if left.score != right.score {
		return left.score > right.score
	}
	return left.index < right.index
}

// peopleANNCompare 是 peopleANNBetter 的排序版本。
func peopleANNCompare(left, right peopleANNCandidate) int {
	if left.score != right.score {
		if left.score > right.score {
			return -1
		}
		return 1
	}
	switch {
	case left.index < right.index:
		return -1
	case left.index > right.index:
		return 1
	default:
		return 0
	}
}

// peopleANNDot 是这张索引里最热的一处：建索引与查索引的时间几乎都在这里。
//
// 两个向量维度必须一致；先把右边的长度对齐，编译器就能去掉循环里的越界检查。
//
// 累加用四个累加器：单个累加器时每一步都要等上一次加法结束，
// 一条链走完五百多次加法要两千多个周期。用四个互不依赖的累加器，
// 这段等待能被流水线填满。
func peopleANNDot(left, right []float32) float32 {
	right = right[:len(left)]
	var first, second, third, fourth float32
	index := 0
	for ; index+3 < len(left); index += 4 {
		first += left[index] * right[index]
		second += left[index+1] * right[index+1]
		third += left[index+2] * right[index+2]
		fourth += left[index+3] * right[index+3]
	}
	score := (first + second) + (third + fourth)
	for ; index < len(left); index++ {
		score += left[index] * right[index]
	}
	return score
}
