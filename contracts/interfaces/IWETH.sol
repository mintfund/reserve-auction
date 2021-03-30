//SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity >=0.5.0;

interface IWETH {
    function withdraw(uint256) external;

    function withdraw(uint256 amount, address user) external;

    function deposit() external payable;

    function balanceOf(address owner) external view returns (uint256);

    function transfer(address to, uint256 value) external returns (bool);
}
