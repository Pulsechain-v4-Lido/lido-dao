const { assertBn, assertRevert, assertEvent, assertAmountOfEvents } = require('@aragon/contract-helpers-test/src/asserts')
const { newDao, newApp } = require('../0.4.24/helpers/dao')
const { ZERO_ADDRESS, getEventAt, getEventArgument } = require('@aragon/contract-helpers-test')

const StakingRouter = artifacts.require('StakingRouter.sol')
const ModuleSolo = artifacts.require('ModuleSolo.sol')
const IModule = artifacts.require('contracts/0.4.24/interfaces/IModule.sol:IModule')

const LidoMock = artifacts.require('LidoMock.sol')
const LidoOracleMock = artifacts.require('OracleMock.sol')
const DepositContractMock = artifacts.require('DepositContractMock.sol')
const NodeOperatorsRegistryMock = artifacts.require('NodeOperatorsRegistryMock')
const RewardEmulatorMock = artifacts.require('RewardEmulatorMock.sol')

const ETH = (value) => web3.utils.toWei(value + '', 'ether')

const ADDRESS_1 = '0x0000000000000000000000000000000000000001'
const ADDRESS_2 = '0x0000000000000000000000000000000000000002'
const ADDRESS_3 = '0x0000000000000000000000000000000000000003'
const ADDRESS_4 = '0x0000000000000000000000000000000000000004'

const pad = (hex, bytesLength) => {
  const absentZeroes = bytesLength * 2 + 2 - hex.length
  if (absentZeroes > 0) hex = '0x' + '0'.repeat(absentZeroes) + hex.substr(2)
  return hex
}

const hexConcat = (first, ...rest) => {
  let result = first.startsWith('0x') ? first : '0x' + first
  rest.forEach((item) => {
    result += item.startsWith('0x') ? item.substr(2) : item
  })
  return result
}

// modules config
const proModule = {
  type: 0, // PRO
  fee: 500, // in basic points
  treasuryFee: 500, // in basic points
  totalKeys: 4000,
  totalUsedKeys: 3000,
  totalStoppedKeys: 100,
  totalExitedKeys: 0,
  softCap: 0,
  assignedDeposits: 0,
  balance: 0
}

const soloModule = {
  type: 1, // SOLO
  fee: 500, // in basic points
  treasuryFee: 0, // in basic points
  totalKeys: 100,
  totalUsedKeys: 10,
  totalStoppedKeys: 1,
  totalExitedKeys: 1,
  softCap: 9000,
  assignedDeposits: 0,
  bond: 16,
  balance: 0
}

const soloModule2 = {
  type: 1, // SOLO
  fee: 500, // in basic points
  treasuryFee: 500, // in basic points
  totalKeys: 200,
  totalUsedKeys: 20,
  totalStoppedKeys: 1,
  softCap: 100,
  assignedDeposits: 0,
  bond: 16,
  balance: 0
}
const soloModule3 = {
  type: 1, // SOLO
  fee: 500, // in basic points
  treasuryFee: 500, // in basic points
  totalKeys: 1000,
  totalUsedKeys: 1000,
  totalStoppedKeys: 100,
  softCap: 100,
  assignedDeposits: 0,
  bond: 20,
  balance: 0
}

const ModuleTypes = ['PRO', 'SOLO', 'DVT']

const modules = []
modules.push(soloModule)
// modules.push(soloModule2)
// modules.push(soloModule3)

contract('StakingRouter', (accounts) => {
  let oracle, lido, burner
  let treasuryAddr
  let dao, acl, operators

  let stakingRouter

  var appManager = accounts[0]
  var voting = accounts[1]
  var deployer = accounts[2]
  var externalAddress = accounts[3]
  var stranger1 = accounts[4]
  var stranger2 = accounts[5]
  /* create named accounts for contract roles */

  before(async () => {
    /* before tests */
    // console.table(modules)
  })

  beforeEach(async () => {
    const lidoBase = await LidoMock.new({ from: deployer })
    oracle = await LidoOracleMock.new({ from: deployer })
    const depositContract = await DepositContractMock.new({ from: deployer })
    const nodeOperatorsRegistryBase = await NodeOperatorsRegistryMock.new({ from: deployer })

    const daoAclObj = await newDao(appManager)
    dao = daoAclObj.dao
    acl = daoAclObj.acl

    // Instantiate a proxy for the app, using the base contract as its logic implementation.
    let proxyAddress = await newApp(dao, 'lido', lidoBase.address, appManager)
    lido = await LidoMock.at(proxyAddress)
    await lido.resumeProtocolAndStaking()

    // NodeOperatorsRegistry
    proxyAddress = await newApp(dao, 'node-operators-registry', nodeOperatorsRegistryBase.address, appManager)
    operators = await NodeOperatorsRegistryMock.at(proxyAddress)
    await operators.initialize(lido.address)

    // Init the BURN_ROLE role and assign in to voting
    await acl.createPermission(voting, lido.address, await lido.BURN_ROLE(), appManager, { from: appManager })

    // Initialize the app's proxy.
    await lido.initialize(depositContract.address, oracle.address, operators.address)
    treasuryAddr = await lido.getInsuranceFund()

    await oracle.setPool(lido.address)
    await depositContract.reset()

    stakingRouter = await StakingRouter.new(lido.address, depositContract.address, { from: appManager })

    // set staking router to lido
    await lido.setStakingRouter(stakingRouter.address)

    const total = await lido.totalSupply()
    const shares = await lido.getTotalShares()

    console.log('--- initialize ---')
    console.log('lido balance', total.toString())
    console.log('lido shares', shares.toString())
  })

  describe('staking router test', () => {
    beforeEach(async () => {
      console.log('--- stranger1 send 20eth ---')
      await web3.eth.sendTransaction({ from: externalAddress, to: lido.address, value: ETH(20) })
      console.log('--- stranger2 send 10eth ---')
      await web3.eth.sendTransaction({ from: stranger2, to: lido.address, value: ETH(10) })
    })

    it(`init counters and burn amount per run works`, async () => {
      // 50% of mintedShares
      await operators.setFee(500, { from: appManager })

      // add NodeOperatorRegistry
      // name, address, cap, treasuryFee
      await stakingRouter.addModule('Curated', operators.address, 0, 500, { from: appManager })

      await operators.setTotalKeys(proModule.totalKeys, { from: appManager })
      await operators.setTotalUsedKeys(proModule.totalUsedKeys, { from: appManager })
      await operators.setTotalStoppedKeys(proModule.totalStoppedKeys, { from: appManager })

      const NORFee = await operators.getFee()
      assertBn(500, NORFee, 'invalid node operator registry fee')

      /**
       *
       *
       *  INITIALIZE modules
       *
       *
       *
       */
      for (i = 0; i < modules.length; i++) {
        const module = modules[i]
        let _module

        // skip pro module
        if (module.type === 0) {
          continue
          // _module = await ModulePro.new(module.type, lido.address, module.fee, module.treasuryFee, { from: appManager })
          // add solo module
        } else if (module.type === 1) {
          _module = await ModuleSolo.new(module.type, lido.address, module.fee, { from: appManager })
        }

        const name = ModuleTypes[module.type] + i

        await stakingRouter.addModule(name, _module.address, module.softCap, module.treasuryFee, { from: appManager })
        await _module.setTotalKeys(module.totalKeys, { from: appManager })
        await _module.setTotalUsedKeys(module.totalUsedKeys, { from: appManager })
        await _module.setTotalStoppedKeys(module.totalStoppedKeys, { from: appManager })

        module.address = _module.address
      }

      await stakingRouterStats(stakingRouter)

      /**
       * print lido stats
       */
      await getLidoStats(lido, {
        Treasury: await lido.getTreasury(),
        Stranger1: externalAddress,
        Stranger2: stranger2,
        StakingRouter: stakingRouter.address,
        Community: modules[0].address
      })

      /**
       *
       * REPORT ORACLE 1ETH rewards
       *
       */
      console.log('report oracle 1 eth')
      const result = await oracle.reportBeacon(100, 0, ETH(1), { from: appManager })

      // 341770 without
      // 350708
      console.log('gas', result.receipt.gasUsed)

      /**
       * stats after rebase
       */
      await getLidoStats(lido, {
        Treasury: await lido.getTreasury(),
        Stranger1: externalAddress,
        Stranger2: stranger2,
        StakingRouter: stakingRouter.address,
        Curated: operators.address,
        Community: modules[0].address
        // Module3: modules[2].address,
        // Module4: modules[3].address
      })
    })
  })
})

async function getLidoStats(lido, args) {
  const data = {}

  const total = await lido.totalSupply()
  const shares = await lido.getTotalShares()

  data.Lido = { total: total.toString(), shares: shares.toString() }

  for (const property in args) {
    const prop = args[property]

    const prop1balance = await lido.balanceOf(prop)
    const prop1shares = await lido.getSharesByPooledEth(prop1balance)

    data[`${property}`] = {
      total: prop1balance.toString(),
      shares: prop1shares.toString()
    }
  }

  console.table(data)
}

async function stakingRouterStats(stakingRouter) {
  let modules = []
  let modulesCount = await stakingRouter.getModulesCount()

  for (let i = 0; i < modulesCount; i++) {
    let module = await stakingRouter.getModule(i)
    let entry = await IModule.at(module.moduleAddress)

    modules.push({
      // address: entry.address,
      name: module.name,
      cap: parseInt(module.cap),
      fee: parseInt(entry.getFee()),
      treasuryFee: parseInt(module.treasuryFee),
      paused: module.paused,
      active: module.active,

      totalKeys: parseInt(await entry.getTotalKeys()),
      totalUsedKeys: parseInt(await entry.getTotalUsedKeys()),
      totalStoppedKeys: parseInt(await entry.getTotalStoppedKeys()),
      totalExitedKeys: parseInt(await entry.getTotalExitedKeys())
    })
  }

  console.table(modules)
}
