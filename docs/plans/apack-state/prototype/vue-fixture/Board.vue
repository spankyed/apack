<!--
  A component written as the app writes one, for `vue-tsc` to check. Nothing runs it: what it holds is what a
  template may and may not read, and each line marked as an error has to be one.

    npx vue-tsc --noEmit -p docs/plans/apack-state/prototype/vue-fixture/tsconfig.json
-->
<script setup lang="ts">
import { within } from '../state.mts'
import { useState } from './board.mts'

const props = defineProps<{ id: string }>()

// What `useState` gives is taken apart by name, so the template reads `board.data.title` with no `.value`.
const { state: board, send, child } = useState('board')
// One of many, following the prop.
const { state: card } = useState(() => child('card', props.id))
</script>

<template>
  <h1>{{ board.data.title }}</h1>
  <p>{{ board.at }}</p>

  <!-- Inside a `v-if` on where the board is, the data of that state can be read. -->
  <p v-if="within(board, 'open')">{{ board.data.openId }}</p>
  <p v-if="board.at === 'open'">{{ board.data.openId }}</p>

  <!-- A card may not be running. Inside a `v-if` on it, or with `?.`, what it holds can be read. -->
  <ul>
    <li v-if="card">{{ card.data.label }} {{ card.data.bumps }}</li>
    <li v-else>nothing</li>
    <li>{{ card?.data.bumps }}</li>
  </ul>

  <ul>
    <li v-for="(label, id) in board.data.items" :key="id">{{ id }}: {{ label }}</li>
  </ul>

  <button @click="send({ type: 'RETITLE', title: 'Another' })">Rename</button>
  <button @click="send({ type: 'OPEN', id: props.id })">Open</button>

  <!--
    What must not be read. Each is bound as an attribute, since the marker that says a line has to be an error
    covers what an element is given and not the text inside it. Unmarked, the text form is refused the same way.
  -->

  <!-- @vue-expect-error which item is open exists only while the board is at `open` -->
  <p :title="board.data.openId" />

  <!-- @vue-expect-error a card may not be running, so what it holds cannot be read without saying what if it is not -->
  <p :title="card.data.label" />

  <!-- @vue-expect-error the board takes no such event -->
  <button @click="send({ type: 'SHUFFLE' })">Shuffle</button>

  <!-- @vue-expect-error an event has to carry what it declares -->
  <button @click="send({ type: 'OPEN' })">Open nothing</button>

  <!-- @vue-expect-error the board has no such field -->
  <p :title="board.data.subtitle" />

  <!-- @vue-expect-error there is no such state to be inside -->
  <p v-if="within(board, 'closed')">closed</p>
</template>
