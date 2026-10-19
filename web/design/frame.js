// Helpers every section of the showcase shares: the layout classes live in design/index.html (sc-*), these build on them.
import React from '../vendor/libs.js'
import { html } from '../spacekit.js'

/** A section's body: the shell supplies the heading and the intro, so this only groups content. */
export const Section = ({ children }) => html`<div>${children}</div>`
export const H3 = ({ children }) => html`<div className="sc-h3">${children}</div>`
export const Cell = ({ caption, children, style }) => html`<div className="sc-cell" style=${style}>${children}<span className="sc-cap">${caption}</span></div>`
