/** @schema */
export type EarlyRef = LateInterface

export interface LateInterface {
  field: LaterInterface
}

export interface LaterInterface {
  field: 1
}