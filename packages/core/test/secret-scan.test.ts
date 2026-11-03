import { describe, expect, it } from 'vitest'
import { findSecrets } from '../src/index.ts'

// Built from pieces so the repo itself never holds a token-shaped string for a secret scanner to trip on.
const gitlab = ['glpat', 'Ab12Cd34Ef56Gh78Ij90'].join('-')
const slack = ['xoxb', '123456789012', '1234567890123', 'AbCdEfGhIjKlMnOpQrStUvWx'].join('-')
const atlassian = `ATA${'TT3xFfGF0'}${'aB1-_='.repeat(30)}`
const privateKey = ['-----BEGIN', 'OPENSSH PRIVATE KEY-----'].join(' ')
const rsaKey = ['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' ')

describe('findSecrets', () => {
  it.each([
    ['a GitLab token', `the token is ${gitlab} for now`, 'GitLab token'],
    ['a Slack token', `SLACK=${slack}`, 'Slack token'],
    ['an Atlassian token', `"${atlassian}"`, 'Atlassian token'],
    ['an OpenSSH private key', `${privateKey}\nb3BlbnNzaC1rZXktdjEAAAAA\n`, 'private key'],
    ['an RSA private key', rsaKey, 'private key'],
  ])('finds %s', (_, text, kind) => {
    expect(findSecrets(text)).toEqual([kind])
  })

  it.each([
    ['plain prose', 'Reviewed group/app!42 with @alice, PAY-1432 is next.'],
    ['a token prefix mentioned in a note', 'GitLab tokens start with glpat- and Slack ones with xoxb-.'],
    ['the Atlassian prefix alone', 'ATATT is how Atlassian tokens begin.'],
    ['a public key', ['-----BEGIN', 'PUBLIC KEY-----'].join(' ')],
    ['a word that merely starts like a Slack token', 'xoxo, see you tomorrow'],
  ])('ignores %s', (_, text) => {
    expect(findSecrets(text)).toEqual([])
  })

  it('names each kind once', () => {
    expect(findSecrets(`${gitlab}\n${gitlab}\n${rsaKey}`)).toEqual(['GitLab token', 'private key'])
  })
})
