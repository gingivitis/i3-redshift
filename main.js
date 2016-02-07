#!/usr/bin/env node

'use strict'

const redis = require('redis')
const _ = require('lodash')
const execFile = require('child_process').execFile
const fs = require('fs')
const async = require('async')

const INACTIVE = {
    code: '0',
    color: '#666666'
}
const ACTIVE = {
    code: '1',
    color: '#ffffff'
}

const client = redis.createClient()
client.on('error', exit)

// generate range from 3000-6500K in steps of 250
const tempRange = _.range(3000, 6750, 250)
const op = process.argv[2]

switch (op) {
    case 'inc':
    case 'dec':
        get(change)
        break

    case 'off':
        get(off)
        break

    case 'on':
        get(on)
        break

    default:
        get(init)
        break
}

function init(data) {
    if (data.status === ACTIVE.code) {
        execFile('redshift', ['-O', data.current || 6500, '-g', 0.8], exit.bind(null, data))
    } else {
        exit(data)
    }
}

function get(cb) {
    client.hgetall('redshift', (err, data) => {
        if (err) {
            return exit({current: err.message})
        }

        return cb(data)
    })
}

function put(newVal, cb) {
    async.parallel([
        function(done) { client.hset('redshift', 'current', newVal, done) },
        function(done) { execFile('redshift', ['-O', newVal, '-g', 0.8], done) }
    ], cb)
}

function on(data) {
    async.parallel([
        function(done) { client.hset('redshift', 'status', ACTIVE.code, done)},
        function(done) { execFile('redshift', ['-O', data.current || 6500, '-g', 0.8], done)}
    ], exit.bind(null, _.assign({}, data, {status: ACTIVE.code})))
}

function off(data) {
    async.parallel([
        function(done) { client.hset('redshift', 'status', INACTIVE.code, done) },
        function(done) { execFile('redshift', ['-x'], done) }
    // ], exit.bind(null, data))
    ], exit.bind(null, _.assign({}, data, {status: INACTIVE.code})))
}

function change(data) {
    if (data.status === INACTIVE.code) {
       return exit()
    }

    let index = tempRange.indexOf(+data.current)

    let newVal = (op === 'inc')
        ? tempRange[index + 1]
        : tempRange[index - 1]

    if (!newVal) exit(data)
    put(newVal, exit.bind(null, data))
}

function exit(data) {
    client.quit()
    write(data)
    process.exit()
}

function write(data) {
    let output = ''

    output += data.current + "K\n\n"
    output += (data.status === ACTIVE.code)
        ? ACTIVE.color
        : INACTIVE.color

    fs.writeFileSync(process.env.HOME + '/tmp/redshift', output)
    execFile('pkill', [`-RTMIN+13`, 'i3blocks'])
}
