import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm'

/**
 * @class Graph
 * A d3 force graph class for storing and visualizing graph data.
 */
export class Graph {
  /**
   * @param {object} data - an object with properties `nodes` and `links`
   * @param {object[]} data.nodes - an array of node objects with properties:
   *    nodes: array<{
   *      id:    string,
   *      label: string,
   *      color: number,
   *      ...
   *    }>,
   * @param {object[]} data.links - an array of link objects with properties:
   *    links: array<{
   *      source: string,
   *      label:  string,
   *      target: string
   *    }>
   *  }
   * @param {object} options - configuration options for the graph
   * @param {string} options.id - the id of the graph SVG element
   * @param {number} options.width - canvas width
   * @param {number} options.height - canvas height
   * @param {number[]} options.viewBox - viewBox for the SVG canvas
   * @param {number[]} options.scaleExtent - bounding box for the canvas
   * @param {array[]} options.translateExtent - bounding box for the canvas
   * @param {Function} options.keyMap - the function for retrieving a node id
   * @param {Function} options.labelMap - the function for retrieving a node label
   * @param {Function} options.titleMap - the function for retrieving a node title
   * @param {Function} options.relationMap - the function for retrieving a link
   * @param {Function} options.valueMap - the function for categorizing a node
   * @param {number} options.chargeStrength - strength of node repulsion
   * @param {Function} options.xMap - horizontal position accessor
   * @param {Function} options.yMap - vertical position accessor
   * @param {Function} options.color - color scheme
   * @param {Function} options.fontSize - label font size
   * @param {Function} options.r - node radius
   * @param {number} options.textLength - label cutoff length
   * @param {number} options.stroke - stroke for links
   * @param {number} options.strokeWidth - stroke width for links
   * @param {number} options.nodeStrokeOpacity - stroke opacity for nodes
   * @param {number} options.linkStrokeOpacity - stroke opacity for links
   * @param {string} options.textColor - label color
   * @param {string} options.halo - color of label halo
   * @param {number} options.haloWidth - padding around the labels
   * @param {number} options.nodeLabelOpacity - default node label opacity
   * @param {number} options.linkLabelOpacity - default link label opacity
   * @param {number} options.highlightOpacity - mouseover label opacity
   * @param {Function} options.nodeLabelXOffset - move node label placement
   **/
  constructor(
    { nodes = [], links = [] },
    {
      id = 'd3_graph_' + Math.random().toString(36).substring(7),
      width = 500,
      height = 500,
      viewBox = [-width / 2, -height / 2, width, height],
      scaleExtent = [0, Infinity],
      translateExtent = [
        [-Infinity, -Infinity],
        [Infinity, Infinity],
      ],
      keyMap = (d) => d.id,
      labelMap = (d) => cropText(d.label, textLength),
      titleMap = (d) => d.label,
      relationMap = (d) => d.label,
      valueMap = (d) => d.type,
      chargeStrength = (d) => d.r || -30,
      xMap = (d) => d.fx || null,
      yMap = (d) => d.fy || null,
      color = d3.scaleOrdinal(d3.schemeCategory10),
      fontSize = 10,
      r = (d) => d.r || 3,
      textLength = 15,
      stroke = 'black',
      strokeWidth = 0.5,
      nodeStrokeOpacity = 0.4,
      linkStrokeOpacity = 0.6,
      textColor = 'black',
      halo = 'GhostWhite',
      haloWidth = 0.25,
      nodeLabelOpacity = 0.1,
      linkLabelOpacity = 0.1,
      highlightOpacity = 0.7,
      nodeLabelXOffset = (d) => r(d) * 1.5,
    } = {},
  ) {
    this.nodes = [...nodes].map((d) => ({ ...d }))
    this.links = [...links].map((d) => ({ ...d }))
    this.id = id
    this.width = width
    this.height = height
    this.viewBox = viewBox
    this.scaleExtent = scaleExtent
    this.translateExtent = translateExtent
    this.keyMap = keyMap
    this.labelMap = labelMap
    this.titleMap = titleMap
    this.relationMap = relationMap
    this.valueMap = valueMap
    this.chargeStrength = chargeStrength
    this.xMap = xMap
    this.yMap = yMap
    this.color = color
    this.fontSize = fontSize
    this.r = r
    this.textLength = textLength
    this.stroke = stroke
    this.strokeWidth = strokeWidth
    this.nodeStrokeOpacity = nodeStrokeOpacity
    this.linkStrokeOpacity = linkStrokeOpacity
    this.textColor = textColor
    this.halo = halo
    this.haloWidth = haloWidth
    this.nodeLabelOpacity = nodeLabelOpacity
    this.linkLabelOpacity = linkLabelOpacity
    this.highlightOpacity = highlightOpacity
    this.nodeLabelXOffset = nodeLabelXOffset

    this.svg = d3
      .create('svg')
      .attr('id', id)
      .attr('class', 'd3_graph')
      .attr('viewBox', viewBox)
      .style('display', 'hidden')
      .style('overflow', 'hidden')

    // Add styles for the user interaction.
    this.svg.append('style').text(`
      .hover circle.highlight { opacity: ${highlightOpacity} }
      .hover circle { opacity: 0.1; }
      .hover line.highlight { opacity: ${highlightOpacity}; }
      .hover line { opacity: 0.1; }
      .hover text.highlight { font-weight: bold; opacity: ${highlightOpacity}; }
      .hover text.secondary { opacity: ${highlightOpacity}; }
      .hover text { opacity: 0.1; }
    `)

    this.svg
      .append('g')
      .attr('class', 'links')
      .attr('stroke', stroke)
      .attr('stroke-opacity', linkStrokeOpacity)

    this.svg.append('g').attr('class', 'nodes')

    this.svg
      .append('g')
      .attr('class', 'link_labels')
      .style('text-anchor', 'middle')
      .style('font-family', 'Arial')
      // .style("font-size", this.fontSize)
      .style('fill', this.textColor)
      // .style('fill', 'white')
      // .style('visibility', 'hidden')
      .style('opacity', this.linkLabelOpacity)
      .style('pointer-events', 'none')

    this.svg
      .append('g')
      .attr('class', 'node_labels')
      .style('text-anchor', 'middle')
      .style('font-family', 'Arial')
      // .style("font-size", this.fontSize)
      .style('fill', this.textColor)
      .style('opacity', this.nodeLabelOpacity)
      // .style('fill', 'white')
      // .style('visibility', 'hidden')
      .style('pointer-events', 'none')

    this.simulation = this.createSimulation()
    Object.assign(this.svg.node(), { simulation: this.simulation })

    this.update()

    this.zoom = d3
      .zoom()
      .scaleExtent(scaleExtent)
      .translateExtent(translateExtent)
      .on('zoom', this.handleZoom(id))
    this.svg.call(this.zoom)
  }

  /**
   * Update the graph with new nodes and links.
   */
  update() {
    this.simulation.nodes(this.nodes)
    this.simulation.force('link').links(this.links)
    this.simulation.restart()

    this.getNodes()
      .data(this.nodes)
      .join('circle')
      .attr('r', this.r)
      .attr('stroke-opacity', this.nodeStrokeOpacity)
      .attr('stroke-width', this.strokeWidth)
      .attr('stroke', this.stroke)
      .attr('fill', (d) => this.color(this.valueMap(d)))
      .on('pointerup', this.handleNodePointerup())
      .on('pointerdown', this.handleNodePointerdown())
      .on('pointerenter', this.handleNodePointerEnter())
      .on('pointerout', this.handleNodePointerout())
      .style('pointer-events', 'all')
      .call(this.handleDrag(this.simulation))
    this.getNodes().append('title').text(this.titleMap)

    this.getLinks()
      .data(this.links)
      .join('line')
      .style('pointer-events', 'none')
      .attr('stroke-width', this.strokeWidth)

    this.getNodeLabels()
      .data(this.nodes)
      .join('text')
      .text((d) => this.labelMap(d))
      .attr('font-size', this.fontSize)
    // .attr("stroke-linejoin", "round")
    // .attr("stroke-width", this.haloWidth)
    // .attr("stroke", this.halo)
    // .attr("paint-order", "stroke")

    this.getLinkLabels()
      .data(this.links)
      .join('text')
      .text((d) => cropText(this.relationMap(d) || '', this.textLength))
      .attr('font-size', this.fontSize)
    // .attr("stroke-linejoin", "round")
    // .attr("stroke-width", this.haloWidth)
    // .attr("stroke", this.halo)
    // .attr("paint-order", "stroke")
  }

  // Getters for the graph elements //

  /**
   * Get the SVG element of the graph
   * @returns {d3.node} the SVG node of the graph
   */
  getSVG = () => this.svg.node()

  /**
   * Get the SVG node group of the graph
   * @returns {d3.selection} the node group
   */
  getNodeGroup = () => this.svg.selectAll(`#${this.id} g.nodes`)

  /**
   * Get the SVG link group of the graph
   * @returns {d3.selection} the link group
   */
  getLinkGroup = () => this.svg.selectAll(`#${this.id} g.links`)

  /**
   * Get the SVG node label group of the graph
   * @returns {d3.selection} the node label group
   */
  getNodeLabelGroup = () => this.svg.selectAll(`#${this.id} g.node_labels`)

  /**
   * Get the SVG link label group of the graph
   * @returns {d3.selection} the link label group
   */
  getLinkLabelGroup = () => this.svg.selectAll(`#${this.id} g.link_labels`)

  /**
   * Get the SVG nodes of the graph
   * @returns {d3.selection} the SVG nodes
   */
  getNodes = () => this.getNodeGroup().selectAll('circle')

  /**
   * Get the SVG link group of the graph
   * @returns {d3.selection} the SVG links
   */
  getLinks = () => this.getLinkGroup().selectAll('line')

  /**
   * Get the SVG node label group of the graph
   * @returns {d3.selection} the SVG node labels
   */
  getNodeLabels = () => this.getNodeLabelGroup().selectAll('text')

  /**
   * Get the SVG link label group of the graph
   * @returns {d3.selection} the SVG link labels
   */
  getLinkLabels = () => this.getLinkLabelGroup().selectAll('text')

  /**
   * Start a force simulation from graph data
   * @returns {d3.forceSimulation} a D3 force simulation object
   */
  createSimulation = () =>
    d3
      .forceSimulation(this.nodes)
      .force('charge', d3.forceManyBody().strength(this.chargeStrength))
      .force('link', d3.forceLink(this.links).id(this.keyMap))
      .force(
        'collide',
        d3
          .forceCollide()
          .radius((d) => this.r(d) * 1.1)
          .iterations(3),
      )
      .force('x', d3.forceX())
      .force('y', d3.forceY())
      .on('tick', this.handleTick())

  /**
   * Create a drag effect for graph nodes within the context of a force simulation
   * @returns {d3.drag} a D3 drag function to enable dragging nodes within the graph
   */
  handleDrag(simulation) {
    /**
     *
     * @param {d3.D3DragEvent} event the drag event containing information on which node is being clicked and dragged
     */
    function dragstarted(event) {
      if (!event.active) simulation.alpha(0.3).restart()
      event.subject.fx = event.subject.x
      event.subject.fy = event.subject.y
    }

    /**
     *
     * @param {d3.D3DragEvent} event the drag event containing information on which node is being clicked and dragged
     */
    function dragged(event) {
      event.subject.fx = event.x
      event.subject.fy = event.y
    }

    /**
     *
     * @param {d3.D3DragEvent} event the drag event containing information on which node is being clicked and dragged
     */
    function dragended(event) {
      if (!event.active) simulation.alphaTarget(0)
      event.subject.fx = null
      event.subject.fy = null
    }

    return d3
      .drag()
      .on('start', dragstarted)
      .on('drag', dragged)
      .on('end', dragended)
  }

  /**
   * A handler function for selecting elements to transform during a zoom event
   *
   */
  handleZoom() {
    return (event) => {
      this.getNodeGroup()
        .attr('height', '100%')
        .attr('width', '100%')
        .attr('transform', event.transform)

      this.getLinkGroup()
        .attr('height', '100%')
        .attr('width', '100%')
        .attr('transform', event.transform)

      this.getNodeLabelGroup()
        // .style("font-size", fontSize / event.transform.k + "px")
        .attr(
          'transform',
          'translate(' +
            event.transform.x +
            ',' +
            event.transform.y +
            ') scale(' +
            event.transform.k +
            ')',
        )

      this.getLinkLabelGroup()
        // .style("font-size", fontSize / event.transform.k + "px")
        .attr(
          'transform',
          'translate(' +
            event.transform.x +
            ',' +
            event.transform.y +
            ') scale(' +
            event.transform.k +
            ')',
        )
    }
  }

  /**
   * A handler function for updating elements to every simulation tick
   */
  handleTick() {
    return () => {
      this.getNodes()
        .attr('cx', (d) => d.x)
        .attr('cy', (d) => d.y)
      this.getNodeLabels()
        .attr('x', (d) => d.x)
        .attr('y', (d) => d.y)
        .attr('dy', (d) => this.nodeLabelXOffset(d))
      this.getLinks()
        .attr('x1', (d) => d.source.x)
        .attr('y1', (d) => d.source.y)
        .attr('x2', (d) => d.target.x)
        .attr('y2', (d) => d.target.y)
      this.getLinkLabels()
        .attr('x', (d) => (d.source.x + d.target.x) / 2)
        .attr('y', (d) => (d.source.y + d.target.y) / 2)
    }
  }

  // Event handlers for node interactions //

  /**
   * function to handle mouseout events on nodes: highlight the hovered node and connected links
   */
  handleNodePointerEnter() {
    return (_event, datum) => {
      this.svg.classed('hover', true)
      this.getNodes()
        .filter((d) => d === datum)
        .classed('highlight', true)
      const label = this.getNodeLabels().filter((d) => d === datum)
      label.classed('highlight', true)
      label.text(this.labelMap(datum))

      const connectedLinks = this.getLinks().filter(
        (l) => l.source === datum || l.target === datum,
      )
      connectedLinks.classed('highlight', true)
      this.getLinkLabelGroup().style('opacity', 0.5)
      // if (!this.performanceMode) {
      this.getLinkLabels().classed(
        'secondary',
        ({ source, target }) => datum === target || datum === source,
      )
      this.getLinkLabels().text((d) => this.relationMap(d))
      // }

      this.getNodeLabelGroup().style('opacity', 1)
      connectedLinks.each((link) => {
        // if (!this.performanceMode) {
        this.getNodes()
          .filter((d) => d === link.source || d === link.target)
          .classed('highlight', true)
        this.getNodeLabels()
          .filter((d) => d === link.source || d === link.target)
          .classed('secondary', true)
        // } else {
        //   this.getNodes()
        //     .find((d) => d === link.source)
        //     .classed('highlight', true)
        // }
      })
    }
  }

  /**
   * function to handle pointerout events on nodes
   */
  handleNodePointerout() {
    return () => {
      this.svg.classed('hover', false)
      this.getNodes().classed('highlight', false)
      this.getNodeLabels()
        .classed('highlight', false)
        .classed('secondary', false)
        .text((d) => cropText(this.relationMap(d), this.textLength))
      this.getNodeLabelGroup().style('opacity', this.nodeLabelOpacity)
      this.getLinks().classed('highlight', false)
      this.getLinkLabels()
        .classed('secondary', false)
        .text((d) => cropText(this.relationMap(d), this.textLength))
      this.getLinkLabelGroup().style('opacity', this.linkLabelOpacity)
    }
  }

  /**
   * function to handle pointerdown events on nodes
   */
  handleNodePointerdown() {
    // return (event, datum) => {
    //   console.debug('event', event);
    //   console.debug('datum', datum);
    // };
  }

  /**
   * function to handle pointerup events on nodes
   */
  handleNodePointerup() {
    // return (event, datum) => {
    //   console.debug('event', event);
    //   console.debug('datum', datum);
    // };
  }
}
