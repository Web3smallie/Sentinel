// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract PerpFactory is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    address public owner;

    struct Market {
        address tokenAddress;
        string tokenName;
        uint256 createdAt;
        bool active;
        uint256 totalLongs;
        uint256 totalShorts;
        uint256 totalFees;
    }

    struct Position {
        address trader;
        uint256 marketId;
        bool isLong;
        uint256 size;
        uint256 collateral;
        uint256 entryPrice;
        uint256 openedAt;
        bool isOpen;
        int256 pnl;
    }

    mapping(uint256 => Market) public markets;
    mapping(uint256 => Position) public positions;
    mapping(address => uint256) public tokenToMarket;
    mapping(address => uint256[]) public traderPositions;

    uint256 public marketCount;
    uint256 public positionCount;
    uint256 public constant FEE_RATE = 10; // 0.1%
    uint256 public constant LEVERAGE = 10; // 10x default

    event MarketCreated(uint256 indexed marketId, address indexed token, string name);
    event PositionOpened(uint256 indexed positionId, address indexed trader, uint256 marketId, bool isLong, uint256 size, uint256 entryPrice);
    event PositionClosed(uint256 indexed positionId, address indexed trader, int256 pnl);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _usdc) {
        usdc = IERC20(_usdc);
        owner = msg.sender;
    }

    // Create a perp market for any token
    function createMarket(
        address tokenAddress,
        string calldata tokenName
    ) external returns (uint256) {
        require(tokenToMarket[tokenAddress] == 0, "Market already exists");

        marketCount++;
        markets[marketCount] = Market({
            tokenAddress: tokenAddress,
            tokenName: tokenName,
            createdAt: block.timestamp,
            active: true,
            totalLongs: 0,
            totalShorts: 0,
            totalFees: 0
        });

        tokenToMarket[tokenAddress] = marketCount;

        emit MarketCreated(marketCount, tokenAddress, tokenName);
        return marketCount;
    }

    // Open a LONG or SHORT position
    function openPosition(
        uint256 marketId,
        bool isLong,
        uint256 collateral,
        uint256 entryPrice
    ) external nonReentrant returns (uint256) {
        require(markets[marketId].active, "Market not active");
        require(collateral > 0, "Collateral must be greater than 0");
        require(entryPrice > 0, "Entry price must be greater than 0");

        // Take collateral from trader
        usdc.safeTransferFrom(msg.sender, address(this), collateral);

        // Calculate fee
        uint256 fee = (collateral * FEE_RATE) / 10000;
        markets[marketId].totalFees += fee;

        uint256 size = collateral * LEVERAGE;

        positionCount++;
        positions[positionCount] = Position({
            trader: msg.sender,
            marketId: marketId,
            isLong: isLong,
            size: size,
            collateral: collateral - fee,
            entryPrice: entryPrice,
            openedAt: block.timestamp,
            isOpen: true,
            pnl: 0
        });

        traderPositions[msg.sender].push(positionCount);

        if (isLong) {
            markets[marketId].totalLongs += size;
        } else {
            markets[marketId].totalShorts += size;
        }

        emit PositionOpened(positionCount, msg.sender, marketId, isLong, size, entryPrice);
        return positionCount;
    }

    // Close a position
    function closePosition(
        uint256 positionId,
        uint256 exitPrice
    ) external nonReentrant {
        Position storage pos = positions[positionId];
        require(pos.isOpen, "Position not open");
        require(pos.trader == msg.sender || msg.sender == owner, "Not position owner");
        require(exitPrice > 0, "Exit price must be greater than 0");

        int256 pnl = calculatePnL(
            pos.isLong,
            pos.entryPrice,
            exitPrice,
            pos.size
        );

        pos.pnl = pnl;
        pos.isOpen = false;

        uint256 payout = 0;
        if (pnl > 0) {
            payout = pos.collateral + uint256(pnl);
        } else {
            uint256 loss = uint256(-pnl);
            if (loss < pos.collateral) {
                payout = pos.collateral - loss;
            }
        }

        if (payout > 0 && usdc.balanceOf(address(this)) >= payout) {
            usdc.safeTransfer(pos.trader, payout);
        }

        if (pos.isLong) {
            markets[pos.marketId].totalLongs -= pos.size;
        } else {
            markets[pos.marketId].totalShorts -= pos.size;
        }

        emit PositionClosed(positionId, pos.trader, pnl);
    }

    // Calculate PnL
    function calculatePnL(
        bool isLong,
        uint256 entryPrice,
        uint256 exitPrice,
        uint256 size
    ) public pure returns (int256) {
        if (isLong) {
            if (exitPrice > entryPrice) {
                return int256((exitPrice - entryPrice) * size / entryPrice);
            } else {
                return -int256((entryPrice - exitPrice) * size / entryPrice);
            }
        } else {
            if (exitPrice < entryPrice) {
                return int256((entryPrice - exitPrice) * size / entryPrice);
            } else {
                return -int256((exitPrice - entryPrice) * size / entryPrice);
            }
        }
    }

    // Get market info
    function getMarket(uint256 marketId) external view returns (Market memory) {
        return markets[marketId];
    }

    // Get position info
    function getPosition(uint256 positionId) external view returns (Position memory) {
        return positions[positionId];
    }

    // Get market ID for token
    function getMarketId(address tokenAddress) external view returns (uint256) {
        return tokenToMarket[tokenAddress];
    }

    // Get trader positions
    function getTraderPositions(address trader) external view returns (uint256[] memory) {
        return traderPositions[trader];
    }

    // Fund the contract for payouts
    function fund(uint256 amount) external onlyOwner {
        usdc.safeTransferFrom(msg.sender, address(this), amount);
    }
}