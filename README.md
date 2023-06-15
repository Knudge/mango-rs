mango-rs
========

Minimal, zero-config MongoDB replica set runner. Fork of
[run-rs](https://github.com/vkarpov15/run-rs) with a lot of guts ripped out.

Usage
-----

There is no npm package/executable for now, as I'd have to change some stuff
about how the package is set up to make that work.

### Install

#### Clone this repo

```sh
git clone https://github.com/Knudge/mango-rs.git
```

#### Install dependencies

```sh
cd mango-rs
npm i
```

### Run

```sh
npm run start -- --version '6.0.2'
```