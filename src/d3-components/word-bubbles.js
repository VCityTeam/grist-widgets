import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm'
import { Graph } from './graph.js'

export class WordBubbles extends Graph {
  /**
   * Create a force-directed "word bubble" layout: single-node circles with
   * wrapped text labels and no links between them.
   *
   * @param {object[]} nodes - an array of node objects (see `Graph`)
   * @param {object} [options={}] - Same as `Graph` options, with the following defaults overridden:
   * @param {number} [options.textLength=60] - label cutoff length
   * @param {number} [options.nodeLabelOpacity=1] - default node label opacity
   * @param {string} [options.textColor='white'] - label color
   * @param {Function} [options.color] - node fill color
   * @param {Function} [options.r] - node radius accessor
   * @param {Function} [options.fontSize] - label font size accessor
   * @param {Function} [options.labelMap] - node label text accessor (wraps/crops the node's `label`)
   * @param {Function} [options.nodeLabelXOffset] - horizontal label offset, based on number of wrapped lines
   */
  constructor(
    nodes,
    {
      textLength = 60,
      nodeLabelOpacity = 1,
      textColor = 'white',
      color = () => 'var(--theme-foreground-focus)',
      r = (d) => d.r || 3,
      fontSize = (d) => d.r / 3.5,
      labelMap = (d) => wrapText(cropText(d.label, textLength), r(d) / 4),
      nodeLabelXOffset = (d) =>
        `${1 - labelMap(d).split('\n').length * 0.75}em`,
    } = {},
  ) {
    super(
      { nodes, links: [] },
      {
        textLength,
        nodeLabelOpacity,
        textColor,
        color,
        r,
        fontSize,
        labelMap,
        nodeLabelXOffset,
        ...arguments[1],
      },
    )
    this.simulation = this.createSimulation()
    Object.assign(this.svg.node(), { simulation: this.simulation })
    this.simulation.restart()
  }

  /**
   * Render nodes/links/labels, then preserve label line breaks
   *
   * @returns {void}
   */
  update() {
    super.update()
    this.getNodeLabels().style('white-space', 'break-spaces')
  }

  /**
   * Build a force simulation for word bubbles: charge (with a max distance),
   * collision, and x/y centering forces, with no link force
   *
   * @returns {d3.Simulation} the configured force simulation
   */
  createSimulation = () =>
    d3
      .forceSimulation(this.nodes)
      .force(
        'charge',
        d3
          .forceManyBody()
          .strength(this.chargeStrength)
          .distanceMax(this.width / 2),
      )
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
   * No-op override that disables the base class's hover-highlight behavior
   *
   * @returns {void}
   */
  handleNodePointerEnter() {}

  /**
   * No-op override that disables the base class's hover-out behavior
   *
   * @returns {void}
   */
  handleNodePointerout() {}
}
