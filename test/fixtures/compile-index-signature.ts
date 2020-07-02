/** @schema */
export interface ITest {
    [extra: string]: any
}

/** @schema */
export interface ITest2 {
    /**
     * @pattern /^blue.*$/
     */
    [extra: string]: any
}

/** @schema */
export interface ITest3 {
    /**
     * @pattern /^blue.*$/
     * @regex /^green.*$/
     */
    [extra: string]: string
}
