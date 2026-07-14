// English base catalog — the source every other locale is translated from.
// Namespaced per component/area; each area's keys live in ./en/<area>.ts.
import app from './en/app'
import builder from './en/builder'
import cliInstances from './en/cliInstances'
import composer from './en/composer'
import instances from './en/instances'
import queue from './en/queue'
import run from './en/run'
import sessions from './en/sessions'
import settings from './en/settings'

export default { app, builder, cliInstances, composer, instances, queue, run, sessions, settings }
