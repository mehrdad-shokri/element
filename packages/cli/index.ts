#!/usr/bin/env node

import findRoot from 'find-root'
const root = findRoot(__dirname)
import { main } from './src/element'
main(root)
